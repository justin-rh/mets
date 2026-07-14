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

let ctxCache: { ctx: Omit<TriageContext, 'corrections'>; at: number } | null = null;

async function getTriageContext(): Promise<TriageContext> {
  if (!ctxCache || Date.now() - ctxCache.at >= 300_000) {
    const queueRows = await db.select().from(teams);
    const catRows = await db.select().from(categories);
    const queueById = new Map(queueRows.map((q) => [q.id, q]));
    const directory = await db
      .select({ name: users.name, department: users.department, location: users.location })
      .from(users)
      .where(sql`${users.isActive} and ${users.role} != 'readonly'`)
      .orderBy(users.name);
    ctxCache = {
      ctx: {
        queues: queueRows.map((q) => ({ slug: q.slug, name: q.name, description: q.description })),
        categories: catRows.map((c) => ({
          name: c.name,
          description: c.description,
          // seed maps categories to queues by design doc; derive from name match fallback IT
          queueSlug: queueById.get(guessQueueId(c.name, queueRows))?.slug ?? 'it-support',
        })),
        directory,
      },
      at: Date.now(),
    };
  }
  // Corrections are never cached — new feedback applies to the very next call.
  return { ...ctxCache.ctx, corrections: await recentCorrections() };
}

/** Latest agent corrections, formatted as few-shot patterns for the prompt. */
async function recentCorrections(limit = 8) {
  const rows = await db
    .select({
      subject: tickets.subject,
      result: aiEnrichments.result,
      feedback: aiEnrichments.feedback,
    })
    .from(aiEnrichments)
    .innerJoin(tickets, eq(tickets.id, aiEnrichments.ticketId))
    .where(and(eq(aiEnrichments.feature, 'triage'), eq(aiEnrichments.status, 'corrected')))
    .orderBy(desc(aiEnrichments.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const original = (r.result as any) ?? {};
    const corrected = (r.feedback as any)?.corrected ?? {};
    const fmt = (v: { category?: string; queueSlug?: string; priority?: number }) =>
      [v.category, v.queueSlug && `queue ${v.queueSlug}`, v.priority && `P${v.priority}`]
        .filter(Boolean).join(', ');
    return {
      subject: r.subject.slice(0, 90),
      aiChose: fmt(original) || 'unknown',
      agentCorrectedTo: fmt(corrected) || 'unknown',
    };
  });
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

export async function overDailyBudget(): Promise<boolean> {
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
      requesterName: users.name, department: users.department, isVip: users.isVip,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, ticketId));
  if (!t) throw Object.assign(new Error('ticket not found'), { statusCode: 404 });

  const ctx = await getTriageContext();
  const outcome = await getAIProvider().triage(
    {
      subject: t.subject, description: t.description,
      requesterName: t.requesterName,
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
    // On-behalf detection: the text said this ticket is really for someone
    // else. Swap before category/queue changes so downstream hooks (approval
    // chain, auto-responses) address the right person.
    if (r.onBehalfOf && (r.confidence.onBehalfOf ?? 0) >= thresholds.autoApply) {
      const matches = await db.select({ id: users.id }).from(users)
        .where(sql`${users.name} = ${r.onBehalfOf} and ${users.isActive} and ${users.role} != 'readonly'`);
      if (matches.length === 1) {
        const { reassignRequester } = await import('../ticketService.js');
        await reassignRequester(ticketId, matches[0]!.id).catch(() => {});
      }
    }

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

  // The score reads sentiment from the enrichment just inserted — rescore so
  // an upset requester climbs the queue (and SHOUTING sinks) immediately.
  const { recomputeScore } = await import('../scoring.js');
  await recomputeScore(db, ticketId);

  // With a category on the ticket, look for a burst of similar reports —
  // a confirmed burst becomes a linked major incident.
  if (mode === 'auto') {
    const { detectMajorIncident } = await import('../incidents.js');
    await detectMajorIncident(ticketId).catch(() => {});
  }

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

/**
 * Agent overrides an AI decision with the right values. Applies the fix to
 * the ticket and stores the labeled correction — which feeds the next
 * triage prompts as a pattern to follow.
 */
export async function correctEnrichment(
  enrichmentId: number,
  actorId: number,
  fix: { categoryId?: number; queueId?: number; priority?: number },
) {
  const [e] = await db.select().from(aiEnrichments).where(eq(aiEnrichments.id, enrichmentId));
  if (!e) throw Object.assign(new Error('enrichment not found'), { statusCode: 404 });

  const changes: TicketChanges = {};
  if (fix.categoryId) changes.categoryId = fix.categoryId;
  if (fix.queueId) changes.queueId = fix.queueId;
  if (fix.priority) changes.priority = fix.priority;
  if (Object.keys(changes).length > 0) {
    await applyTicketChanges(e.ticketId, { id: actorId }, changes);
  }

  const [cat] = fix.categoryId
    ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, fix.categoryId))
    : [undefined];
  const [q] = fix.queueId
    ? await db.select({ slug: teams.slug }).from(teams).where(eq(teams.id, fix.queueId))
    : [undefined];

  const r = e.result as any;
  await db.update(aiEnrichments).set({
    status: 'corrected',
    feedback: {
      original: { category: r?.category, queueSlug: r?.queueSlug, priority: r?.priority },
      corrected: { category: cat?.name, queueSlug: q?.slug, priority: fix.priority },
      byUserId: actorId,
      at: new Date().toISOString(),
    },
  }).where(eq(aiEnrichments.id, enrichmentId));

  await db.insert(schema.ticketEvents).values({
    ticketId: e.ticketId, actorId, actorType: 'user', eventType: 'ai_corrected',
    oldValue: [r?.category, r?.queueSlug, r?.priority && `P${r.priority}`].filter(Boolean).join(' / '),
    newValue: [cat?.name, q?.slug, fix.priority && `P${fix.priority}`].filter(Boolean).join(' / '),
  });

  return { ok: true };
}

/** Recent AI routing decisions + outcome stats — the triage transparency log. */
export async function listDecisions(limit = 50) {
  const rows = await db
    .select({
      enrichment: aiEnrichments,
      ticket: { id: tickets.id, number: tickets.number, subject: tickets.subject, priority: tickets.priority },
      currentQueue: teams.name,
      currentCategory: categories.name,
    })
    .from(aiEnrichments)
    .innerJoin(tickets, eq(tickets.id, aiEnrichments.ticketId))
    .innerJoin(teams, eq(teams.id, tickets.queueId))
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(eq(aiEnrichments.feature, 'triage'))
    .orderBy(desc(aiEnrichments.createdAt))
    .limit(limit);

  const [stats] = (await db.execute(sql`
    select
      count(*) as total,
      count(*) filter (where status = 'auto_applied') as auto_applied,
      count(*) filter (where status = 'applied') as accepted,
      count(*) filter (where status = 'corrected') as corrected,
      count(*) filter (where status = 'dismissed') as dismissed,
      count(*) filter (where status = 'pending') as pending
    from ai_enrichments
    where feature = 'triage' and created_at > now() - interval '30 days'
  `)).rows as any[];

  return { decisions: rows, stats };
}
