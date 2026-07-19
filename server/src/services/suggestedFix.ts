// Similar-ticket grounding: SOTO proposes a fix for the ticket being worked,
// drawn from what actually resolved the most similar past tickets (hybrid
// FTS + vector search over the resolved backlog) plus matching KB excerpts.
// Every call is metered (ai_usage) and audited (ai_enrichments), like every
// other AI feature.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider, PROMPT_VERSION } from './ai/provider.js';
import { overDailyBudget } from './ai/enrichment.js';
import { hybridSearch, similarResolvedTickets } from './kb/kbService.js';

const { tickets, ticketComments, users, kbArticles, aiUsage, aiEnrichments } = schema;

export type SuggestedFix = {
  id: number;
  result: Record<string, unknown>;
  createdAt: Date;
};

/** The cached latest suggestion, if one was ever generated for this ticket. */
export async function latestSuggestedFix(ticketId: number): Promise<SuggestedFix | null> {
  const [e] = await db.select().from(aiEnrichments)
    .where(and(eq(aiEnrichments.ticketId, ticketId), eq(aiEnrichments.feature, 'suggest_fix')))
    .orderBy(desc(aiEnrichments.createdAt))
    .limit(1);
  return e ? { id: e.id, result: e.result as Record<string, unknown>, createdAt: e.createdAt } : null;
}

function ago(date: string | Date): string {
  const days = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Generate a fresh suggestion. Costs one LLM call — the UI caches via GET. */
export async function suggestFix(ticketId: number): Promise<SuggestedFix> {
  if (await overDailyBudget()) throw Object.assign(new Error('AI daily token budget exhausted'), { statusCode: 429 });

  const [t] = await db.select({ subject: tickets.subject, description: tickets.description })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t) throw Object.assign(new Error('ticket not found'), { statusCode: 404 });

  const query = `${t.subject} ${t.description.slice(0, 300)}`;
  const [similar, kbHits] = await Promise.all([
    similarResolvedTickets(query, ticketId, 4),
    hybridSearch(query, 2),
  ]);

  // Each similar ticket's resolution lives in its last few comments (agent
  // work notes and the closing reply) — that's what gets quoted to the model.
  const detailed = [] as { number: string; subject: string; resolvedAgo: string; resolution: string }[];
  for (const s of similar) {
    const thread = await db.select({
      body: ticketComments.bodyText,
      author: users.name,
      visibility: ticketComments.visibility,
    })
      .from(ticketComments)
      .innerJoin(users, eq(users.id, ticketComments.authorId))
      .where(eq(ticketComments.ticketId, s.id))
      .orderBy(desc(ticketComments.createdAt))
      .limit(4);
    detailed.push({
      number: s.number,
      subject: s.subject,
      resolvedAgo: ago(s.resolved_at),
      resolution: thread.reverse()
        .map((c) => `${c.author}${c.visibility === 'internal' ? ' (internal)' : ''}: ${c.body.slice(0, 350)}`)
        .join('\n') || '(resolution thread not recorded)',
    });
  }

  // Full article bodies ground better than the 220-char search snippets.
  const articles = kbHits.length
    ? (await db.select({ title: kbArticles.title, body: kbArticles.bodyText })
        .from(kbArticles)
        .where(inArray(kbArticles.id, kbHits.map((h) => h.id)))
        .orderBy(asc(kbArticles.id)))
        .map((a) => ({ title: a.title, excerpt: a.body.slice(0, 1200) }))
    : [];

  // Nothing to ground in — decline without spending an LLM call.
  if (detailed.length === 0 && articles.length === 0) {
    const result = {
      hasSuggestion: false, suggestionMarkdown: '', basedOn: [],
      caveat: 'No similar resolved tickets or KB articles found to draw from.',
      confidence: 0, similar: [],
    };
    const [e] = await db.insert(aiEnrichments).values({
      ticketId, feature: 'suggest_fix', status: 'pending',
      model: 'none', promptVersion: PROMPT_VERSION,
      result, confidence: { overall: 0 },
    }).returning();
    return { id: e!.id, result, createdAt: e!.createdAt };
  }

  const outcome = await getAIProvider().suggestResolution({
    subject: t.subject,
    description: t.description,
    similar: detailed,
    articles,
  });

  await db.insert(aiUsage).values({
    feature: 'suggest_fix', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });

  // The similar-ticket chips ride inside the stored result so the cached
  // GET can render the same panel without re-searching.
  const result = {
    ...outcome.result,
    similar: detailed.map(({ number, subject }) => ({ number, subject })),
  };
  const [e] = await db.insert(aiEnrichments).values({
    ticketId, feature: 'suggest_fix', status: 'pending',
    model: outcome.model, promptVersion: PROMPT_VERSION,
    result, confidence: { overall: outcome.result.confidence },
  }).returning();
  return { id: e!.id, result, createdAt: e!.createdAt };
}
