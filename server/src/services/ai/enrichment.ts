import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { env } from '../../config.js';
import { applyTicketChanges, type TicketChanges } from '../ticketService.js';
import { getAIProvider, PROMPT_VERSION, type TriageContext } from './provider.js';

const { tickets, users, categories, teams, aiEnrichments, aiUsage, appConfig } = schema;

const AI_ACTOR = { id: null, type: 'ai' as const };

// Confidence gates. Above autoApply the change is made (auditable, revertible);
// between the two it's a one-click suggestion; below suggest it's left for
// human triage. LLM confidence is a ranking signal — tune against corrections.
const DEFAULT_THRESHOLDS = { autoApply: 0.8, suggest: 0.35 };

async function getThresholds() {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'ai_thresholds'));
  return row ? { ...DEFAULT_THRESHOLDS, ...(row.value as object) } : DEFAULT_THRESHOLDS;
}

let ctxCache: { ctx: TriageContext; at: number } | null = null;

async function getTriageContext(): Promise<TriageContext> {
  if (ctxCache && Date.now() - ctxCache.at < 300_000) return ctxCache.ctx;
  const queueRows = await db.select().from(teams);
  const catRows = await db.select().from(categories);
  const queueById = new Map(queueRows.map((q) => [q.id, q]));
  const ctx: TriageContext = {
    queues: queueRows.map((q) => ({ slug: q.slug, name: q.name, description: q.description })),
    categories: catRows.map((c) => ({
      name: c.name,
      description: c.description,
      // seed maps categories to queues by design doc; derive from name match fallback IT
      queueSlug: queueById.get(guessQueueId(c.name, queueRows))?.slug ?? 'it-support',
    })),
  };
  ctxCache = { ctx, at: Date.now() };
  return ctx;
}

// Category → owning queue mapping mirrors seed-data CATEGORIES.
const CATEGORY_QUEUE: Record<string, string> = {
  'Hardware': 'it-support', 'Software': 'it-support', 'Email & Collaboration': 'it-support',
  'Printing & Labels': 'it-support', 'Phones & Mobile': 'it-support', 'Onboarding & Offboarding': 'it-support',
  'Network & VPN': 'infra-network', 'Warehouse Tech': 'infra-network',
  'MERP': 'merp', 'Business Apps': 'apps-erp',
  'Access & Accounts': 'security-access', 'Security': 'security-access',
  'Data & Reporting': 'data-reporting', 'Facilities': 'facilities',
  'Product & Pricing': 'product-pricing', 'AI & Enablement': 'ai-enablement',
  'Warehouse Operations': 'warehouse-ops', 'Supply Chain & Logistics': 'supply-chain',
  'DC Solutions': 'dc-solutions', 'Sales Support': 'sales-support',
  'AMAT Program': 'amat', 'Finance & Accounting': 'finance',
  'People Operations': 'people-ops', 'Quality': 'quality',
};

function guessQueueId(categoryName: string, queues: (typeof teams.$inferSelect)[]): number {
  const slug = CATEGORY_QUEUE[categoryName] ?? 'it-support';
  return queues.find((q) => q.slug === slug)?.id ?? queues[0]!.id;
}

async function overDailyBudget(): Promise<boolean> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(input_tokens + output_tokens), 0)`.mapWith(Number) })
    .from(aiUsage)
    .where(sql`created_at > now() - interval '24 hours'`);
  return (row?.total ?? 0) > env.aiDailyTokenBudget;
}

export type EnrichMode = 'auto' | 'suggest';

/**
 * Run AI triage on one ticket. mode='auto' applies high-confidence fields
 * (new-ticket flow); mode='suggest' only records the suggestion (Triage tab
 * over existing backlog). AI never runs in the synchronous create path —
 * callers fire-and-forget; failures leave the ticket untouched.
 */
export async function enrichTicket(ticketId: number, mode: EnrichMode = 'suggest') {
  if (await overDailyBudget()) throw Object.assign(new Error('AI daily token budget exhausted'), { statusCode: 429 });

  const [t] = await db
    .select({
      id: tickets.id, subject: tickets.subject, description: tickets.description,
      priority: tickets.priority, source: tickets.source,
      categoryId: tickets.categoryId, queueId: tickets.queueId,
      department: users.department, isVip: users.isVip,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, ticketId));
  if (!t) throw Object.assign(new Error('ticket not found'), { statusCode: 404 });

  const ctx = await getTriageContext();
  const outcome = await getAIProvider().triage(
    {
      subject: t.subject, description: t.description,
      requesterDepartment: t.department, requesterIsVip: t.isVip,
      source: t.source, statedPriority: t.priority,
    },
    ctx,
  );

  await db.insert(aiUsage).values({
    feature: 'triage', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });

  const thresholds = await getThresholds();
  const r = outcome.result;
  const category = await db.select().from(categories).where(eq(categories.name, r.category)).then((rows) => rows[0]);
  const queue = await db.select().from(teams).where(eq(teams.slug, r.queueSlug)).then((rows) => rows[0]);

  let status = 'pending';
  if (mode === 'auto') {
    const changes: TicketChanges = {};
    if (category && r.confidence.category >= thresholds.autoApply && category.id !== t.categoryId) {
      changes.categoryId = category.id;
    }
    if (queue && r.confidence.queue >= thresholds.autoApply && queue.id !== t.queueId) {
      changes.queueId = queue.id;
    }
    if (r.confidence.priority >= thresholds.autoApply && r.priority !== t.priority) {
      changes.priority = r.priority;
    }
    if (Object.keys(changes).length > 0) {
      await applyTicketChanges(ticketId, AI_ACTOR, changes);
      status = 'auto_applied';
    } else {
      status = 'pending';
    }
  }

  const [enrichment] = await db.insert(aiEnrichments).values({
    ticketId, feature: 'triage', status,
    model: outcome.model, promptVersion: PROMPT_VERSION,
    result: r, confidence: r.confidence,
  }).returning();

  return enrichment!;
}

/** Enrich up to `limit` open tickets that have no triage enrichment yet. */
export async function batchTriage(limit: number, ticketIds?: number[]) {
  let ids: number[];
  if (ticketIds?.length) {
    ids = ticketIds.slice(0, limit);
  } else {
    const rows = await db.execute(sql`
      select t.id from tickets t
      join statuses s on s.id = t.status_id
      where s.category in ('new','open','pending')
        and (t.snoozed_until is null or t.snoozed_until <= now())
        and not exists (
          select 1 from ai_enrichments e
          where e.ticket_id = t.id and e.feature = 'triage'
        )
      order by t.score desc, t.created_at desc
      limit ${limit}
    `);
    ids = rows.rows.map((r: any) => Number(r.id));
  }

  const results: { ticketId: number; ok: boolean; error?: string }[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((id) => enrichTicket(id, 'suggest')));
    settled.forEach((s, j) => {
      results.push(
        s.status === 'fulfilled'
          ? { ticketId: slice[j]!, ok: true }
          : { ticketId: slice[j]!, ok: false, error: (s.reason as Error).message },
      );
    });
  }
  return results;
}

/** Latest pending triage suggestions joined with their tickets, for the Triage tab. */
export async function listTriageSuggestions() {
  const rows = await db
    .select({
      enrichment: aiEnrichments,
      ticket: {
        id: tickets.id, number: tickets.number, subject: tickets.subject,
        priority: tickets.priority, score: tickets.score, createdAt: tickets.createdAt,
        queueId: tickets.queueId, categoryId: tickets.categoryId,
      },
      queueName: teams.name,
      categoryName: categories.name,
      requesterName: users.name,
    })
    .from(aiEnrichments)
    .innerJoin(tickets, eq(tickets.id, aiEnrichments.ticketId))
    .innerJoin(teams, eq(teams.id, tickets.queueId))
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(and(eq(aiEnrichments.feature, 'triage'), eq(aiEnrichments.status, 'pending')))
    .orderBy(desc(aiEnrichments.createdAt))
    .limit(50);
  return rows;
}

/** Apply an accepted suggestion; the agent decision is the feedback signal. */
export async function acceptEnrichment(enrichmentId: number, actorId: number, fields: { category: boolean; queue: boolean; priority: boolean }) {
  const [e] = await db.select().from(aiEnrichments).where(eq(aiEnrichments.id, enrichmentId));
  if (!e) throw Object.assign(new Error('enrichment not found'), { statusCode: 404 });
  const r = e.result as any;

  const changes: TicketChanges = {};
  if (fields.category) {
    const [cat] = await db.select().from(categories).where(eq(categories.name, r.category));
    if (cat) changes.categoryId = cat.id;
  }
  if (fields.queue) {
    const [q] = await db.select().from(teams).where(eq(teams.slug, r.queueSlug));
    if (q) changes.queueId = q.id;
  }
  if (fields.priority) changes.priority = r.priority;

  if (Object.keys(changes).length > 0) {
    await applyTicketChanges(e.ticketId, { id: actorId }, changes);
  }
  await db.update(aiEnrichments).set({ status: 'applied' }).where(eq(aiEnrichments.id, enrichmentId));
  return { ok: true };
}

export async function dismissEnrichment(enrichmentId: number) {
  await db.update(aiEnrichments).set({ status: 'dismissed' }).where(eq(aiEnrichments.id, enrichmentId));
  return { ok: true };
}
