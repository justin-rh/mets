import { and, asc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider } from './ai/provider.js';
import { overDailyBudget } from './ai/enrichment.js';
import { getBotUser } from './templates.js';

const { tickets, ticketComments, ticketEvents, kbArticles, categories, users, aiEnrichments, aiUsage } = schema;

const MIN_CONFIDENCE = 0.6;

/**
 * On resolve: if the resolution thread contains a repeatable fix, AI drafts a
 * KB article (status draft — invisible to search until an agent publishes it
 * from the KB tab). Conservative by prompt; once per ticket; skips tickets
 * with no substantive staff replies.
 */
export async function maybeDraftArticle(ticketId: number) {
  const [existing] = await db.select({ id: aiEnrichments.id }).from(aiEnrichments)
    .where(and(eq(aiEnrichments.ticketId, ticketId), eq(aiEnrichments.feature, 'kb_draft')));
  if (existing) return null;
  if (await overDailyBudget()) return null;

  const [t] = await db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, categoryName: categories.name,
    })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(eq(tickets.id, ticketId));
  if (!t) return null;

  const comments = await db
    .select({
      body: ticketComments.bodyText, visibility: ticketComments.visibility,
      authorName: users.name, authorRole: users.role,
    })
    .from(ticketComments)
    .innerJoin(users, eq(users.id, ticketComments.authorId))
    .where(eq(ticketComments.ticketId, ticketId))
    .orderBy(asc(ticketComments.createdAt));

  // No human resolution content, nothing to document.
  const staffText = comments
    .filter((c) => c.authorRole === 'agent' || c.authorRole === 'admin')
    .map((c) => c.body).join(' ');
  if (staffText.length < 80) return null;

  const existingTitles = (await db.select({ title: kbArticles.title }).from(kbArticles)
    .where(ne(kbArticles.status, 'archived'))).map((r) => r.title);

  const outcome = await getAIProvider().draftArticle({
    subject: t.subject,
    description: t.description,
    categoryName: t.categoryName ?? 'General',
    thread: comments.slice(-10).map((c) => ({
      author: c.authorName, visibility: c.visibility, body: c.body,
    })),
    existingTitles,
  });
  await db.insert(aiUsage).values({
    feature: 'kb_draft', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });

  const r = outcome.result;
  if (!r.worthArticle || r.confidence < MIN_CONFIDENCE) {
    await db.insert(aiEnrichments).values({
      ticketId, feature: 'kb_draft', status: 'dismissed',
      model: outcome.model, promptVersion: 'kb-draft-v1', result: r, confidence: { article: r.confidence },
    });
    return null;
  }

  const bot = await getBotUser();
  const [article] = await db.insert(kbArticles).values({
    title: r.title,
    bodyText: `${r.bodyMarkdown}\n\n---\nDrafted by AI from ${t.number} (${t.categoryName ?? 'General'}). Review before publishing.`,
    status: 'draft', authorId: bot.id, sourceTicketId: ticketId,
  }).returning();

  await db.insert(aiEnrichments).values({
    ticketId, feature: 'kb_draft', status: 'pending',
    model: outcome.model, promptVersion: 'kb-draft-v1', result: { ...r, articleId: article!.id },
    confidence: { article: r.confidence },
  });
  await db.insert(ticketEvents).values({
    ticketId, actorId: null, actorType: 'ai', eventType: 'kb_drafted',
    field: 'kb', newValue: r.title,
  });
  return article!;
}
