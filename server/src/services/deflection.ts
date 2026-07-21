import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider } from './ai/provider.js';
import { getBotUser } from './templates.js';

const { tickets, ticketComments, ticketEvents, aiUsage, users, kbArticles } = schema;

type DeflectionState = {
  articleId: number;
  articleTitle: string;
  state: 'offered' | 'accepted' | 'declined';
};

const SOLVED = /\b(solved|that (worked|fixed it)|fixed( it)?|it'?s (fixed|working( now)?)|works now|all set|resolved|problem gone)\b/i;

async function getTicket(ticketId: number) {
  const [t] = await db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, priority: tickets.priority,
      customFields: tickets.customFields, statusId: tickets.statusId,
      requesterName: users.name,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, ticketId));
  return t;
}

async function saveState(ticketId: number, customFields: unknown, deflection: DeflectionState) {
  await db.update(tickets)
    .set({ customFields: { ...(customFields as object ?? {}), deflection }, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));
}

/**
 * After triage: if a KB article genuinely solves this ticket, SOTO offers
 * the fix before any agent looks — "reply 'solved' and I'll close it."
 * The kbArticles hybrid search finds the candidate; the AI is the precision
 * gate that decides it actually applies (and writes the adapted steps).
 */
export async function maybeOfferDeflection(ticketId: number) {
  const t = await getTicket(ticketId);
  if (!t) return;
  const cf = t.customFields as any;
  if (cf?.deflection) return;        // already offered
  if (cf?.intake) return;            // guided intake owns this conversation
  if (t.priority === 1) return;      // business-stopping — straight to a human

  // Incident children get the "you're not alone" flow instead.
  const [linked] = (await db.execute(sql`
    select 1 from ticket_links where ticket_id = ${ticketId} limit 1
  `)).rows;
  if (linked) return;

  // excludeInternal: the requester is the audience here — internal-only
  // articles (registry edits, admin procedures) must never be offered.
  const { hybridSearch } = await import('./kb/kbService.js');
  const hits = await hybridSearch(`${t.subject} ${t.description.slice(0, 300)}`, 1, { excludeInternal: true });
  if (hits.length === 0) return;
  const [article] = await db
    .select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.bodyText, status: kbArticles.status, internalOnly: kbArticles.internalOnly })
    .from(kbArticles).where(eq(kbArticles.id, hits[0]!.id));
  if (!article || article.status !== 'published' || article.internalOnly) return; // never self-serve drafts or internal fixes

  const outcome = await getAIProvider().suggestFix({
    subject: t.subject, description: t.description,
    article: { title: article.title, body: article.body },
  });
  await db.insert(aiUsage).values({
    feature: 'deflection', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });
  const r = outcome.result;
  if (!r.canDeflect || r.confidence < 0.7 || !r.reply.trim()) return;

  const bot = await getBotUser();
  const first = t.requesterName.split(' ')[0];
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'public', source: 'api',
    bodyText: `Hi ${first} — this looks like a known issue with a self-service fix:\n\n${r.reply.trim()}\n\n(From the knowledge-base article "${article.title}".)\n\nIf that solves it, just reply "solved" and I'll close this ticket. If not, reply with what you're seeing and an agent will take it from here.\n\n— SOTO Bot`,
  });
  await db.insert(ticketEvents).values({
    ticketId, actorId: bot.id, actorType: 'ai', eventType: 'kb_deflection_offered',
    field: 'kb', newValue: article.title, oldValue: `confidence ${Math.round(r.confidence * 100)}%`,
  });
  // A concrete fix is a real first response — the SLA clock agrees.
  const [before] = await db.select({ firstRespondedAt: tickets.firstRespondedAt })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!before?.firstRespondedAt) {
    await db.update(tickets).set({ firstRespondedAt: new Date(), updatedAt: new Date() })
      .where(eq(tickets.id, ticketId));
    const { completeFirstResponse } = await import('./sla/slaService.js');
    await completeFirstResponse(ticketId);
  }
  await saveState(ticketId, t.customFields, {
    articleId: article.id, articleTitle: article.title, state: 'offered',
  });
}

/**
 * Requester replied on a ticket with a deflection offer outstanding.
 * "solved" (and friends) closes the ticket as deflected; anything else
 * hands it to an agent with a note — SOTO never nags twice.
 */
export async function handleDeflectionReply(ticketId: number, bodyText: string) {
  const t = await getTicket(ticketId);
  if (!t) return;
  const deflection = (t.customFields as any)?.deflection as DeflectionState | undefined;
  if (!deflection || deflection.state !== 'offered') return;

  const bot = await getBotUser();
  if (SOLVED.test(bodyText)) {
    await saveState(ticketId, t.customFields, { ...deflection, state: 'accepted' });
    await db.insert(ticketComments).values({
      ticketId, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Glad that fixed it! Closing this ticket — the fix came from "${deflection.articleTitle}". If it comes back, just reply here and the ticket reopens automatically.\n\n— SOTO Bot`,
    });
    await db.insert(ticketEvents).values({
      ticketId, actorId: bot.id, actorType: 'ai', eventType: 'kb_deflected',
      field: 'kb', newValue: deflection.articleTitle,
    });
    const [resolved] = await db.select().from(schema.statuses)
      .where(eq(schema.statuses.category, 'resolved')).orderBy(schema.statuses.position).limit(1);
    if (resolved) {
      const { applyTicketChanges } = await import('./ticketService.js');
      await applyTicketChanges(ticketId, { id: null, type: 'system' }, { statusId: resolved.id });
    }
    return;
  }

  await saveState(ticketId, t.customFields, { ...deflection, state: 'declined' });
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'internal', source: 'api',
    bodyText: `Self-service fix ("${deflection.articleTitle}") didn't solve it — needs an agent. Requester's follow-up is above.\n\n— SOTO Bot`,
  });
}
