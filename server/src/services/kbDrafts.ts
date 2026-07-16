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
 *
 * force = an agent asked for this draft explicitly (the ticket-side button):
 * their judgment overrides the automatic gates — the once-per-ticket guard,
 * the thread-length minimum, and the AI's own worth-an-article verdict.
 */
export async function maybeDraftArticle(ticketId: number, opts: { force?: boolean } = {}) {
  // An unreviewed draft from this ticket already exists — hand it back
  // instead of piling up duplicates.
  const [pendingDraft] = await db.select().from(kbArticles)
    .where(and(eq(kbArticles.sourceTicketId, ticketId), eq(kbArticles.status, 'draft')));
  if (pendingDraft) return opts.force ? pendingDraft : null;

  const [existing] = await db.select({ id: aiEnrichments.id }).from(aiEnrichments)
    .where(and(eq(aiEnrichments.ticketId, ticketId), eq(aiEnrichments.feature, 'kb_draft')));
  if (existing && !opts.force) return null;
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
  if (staffText.length < 80 && !opts.force) return null;

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
    requested: !!opts.force,
  });
  await db.insert(aiUsage).values({
    feature: 'kb_draft', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });

  const r = outcome.result;
  // A forced draft must never be blank — if the model still returned an
  // empty body despite the explicit instruction, fail loudly rather than
  // saving a hollow article (the route surfaces this to the agent).
  if (opts.force && !r.bodyMarkdown.trim()) {
    await db.insert(aiEnrichments).values({
      ticketId, feature: 'kb_draft', status: 'dismissed',
      model: outcome.model, promptVersion: 'kb-draft-v2', result: r, confidence: { article: r.confidence },
    });
    return null;
  }
  if (!r.title.trim()) r.title = `${t.subject} — resolution notes`;
  if ((!r.worthArticle || r.confidence < MIN_CONFIDENCE) && !opts.force) {
    await db.insert(aiEnrichments).values({
      ticketId, feature: 'kb_draft', status: 'dismissed',
      model: outcome.model, promptVersion: 'kb-draft-v2', result: r, confidence: { article: r.confidence },
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
    model: outcome.model, promptVersion: 'kb-draft-v2', result: { ...r, articleId: article!.id },
    confidence: { article: r.confidence },
  });
  await db.insert(ticketEvents).values({
    ticketId, actorId: null, actorType: 'ai', eventType: 'kb_drafted',
    field: 'kb', newValue: r.title,
  });
  return article!;
}
