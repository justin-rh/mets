import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type Weights = {
  priority: Record<string, number>;
  agePerBusinessDay: number;
  ageCap: number;
  vip: number;
  slaWarning: number;
  slaBreached: number;
  sentimentFrustrated: number;
  sentimentUrgent: number;
  allCapsPenalty: number;
};

const DEFAULT_WEIGHTS: Weights = {
  priority: { '1': 40, '2': 25, '3': 12, '4': 5 },
  agePerBusinessDay: 2, ageCap: 20, vip: 15, slaWarning: 10, slaBreached: 25,
  sentimentFrustrated: 10, sentimentUrgent: 5, allCapsPenalty: 10,
};

/**
 * Shouting detector: a subject or description that is mostly capital
 * letters. SHOUTING DOES NOT MAKE YOUR TICKET MORE URGENT — house rule,
 * it makes it less.
 */
export function isShouting(subject: string, description: string): boolean {
  const shouty = (s: string) => {
    const letters = s.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 12) return false;
    const upper = s.replace(/[^A-Z]/g, '').length;
    return upper / letters.length > 0.75;
  };
  return shouty(subject) || shouty(description);
}

let cache: { weights: Weights; at: number } | null = null;

/** Drop the cached weights so admin edits take effect immediately. */
export function invalidateScoreWeightsCache() {
  cache = null;
  keywordCache = null;
}

export async function getScoreWeights(): Promise<Weights> {
  if (cache && Date.now() - cache.at < 60_000) return cache.weights;
  const [row] = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, 'score_weights'));
  const weights = row ? ({ ...DEFAULT_WEIGHTS, ...(row.value as object) } as Weights) : DEFAULT_WEIGHTS;
  cache = { weights, at: Date.now() };
  return weights;
}

// Admin-configurable flag keywords: a match in subject/description boosts the
// score and flags the row (🚩). Matched terms persist to custom_fields so the
// queue can show them without re-scanning text.
export type ScoreKeyword = { term: string; boost: number };

let keywordCache: { keywords: ScoreKeyword[]; at: number } | null = null;

export async function getScoreKeywords(): Promise<ScoreKeyword[]> {
  if (keywordCache && Date.now() - keywordCache.at < 60_000) return keywordCache.keywords;
  const [row] = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, 'score_keywords'));
  const keywords = (row?.value as ScoreKeyword[] | undefined) ?? [];
  keywordCache = { keywords, at: Date.now() };
  return keywords;
}

export function matchKeywords(keywords: ScoreKeyword[], subject: string, description: string) {
  const text = `${subject}\n${description}`.toLowerCase();
  return keywords.filter((k) => k.term && text.includes(k.term.toLowerCase()));
}

function businessDaysBetween(a: Date, b: Date): number {
  let days = 0;
  const cur = new Date(a);
  while (cur < b) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setTime(cur.getTime() + 86_400_000);
  }
  return days;
}

/** Recompute and persist a ticket's score. Call inside the same tx as changes. */
export async function recomputeScore(tx: typeof db, ticketId: number): Promise<number> {
  const w = await getScoreWeights();
  const keywords = await getScoreKeywords();
  const [t] = await tx
    .select({
      priority: schema.tickets.priority,
      createdAt: schema.tickets.createdAt,
      resolvedAt: schema.tickets.resolvedAt,
      manualBoost: schema.tickets.manualBoost,
      subject: schema.tickets.subject,
      description: schema.tickets.description,
      customFields: schema.tickets.customFields,
      // Effective VIP: global, or designated VIP for THIS ticket's queue.
      // Queue moves rescore, so the flag tracks the ticket automatically.
      isVip: sql<boolean>`${schema.users.isVip} or exists (
        select 1 from queue_vips qv
        where qv.user_id = ${schema.tickets.requesterId} and qv.team_id = ${schema.tickets.queueId}
      )`,
    })
    .from(schema.tickets)
    .innerJoin(schema.users, eq(schema.users.id, schema.tickets.requesterId))
    .where(eq(schema.tickets.id, ticketId));
  if (!t) return 0;

  const [slaRow] = await tx
    .select({ state: schema.slaInstances.state, warnAt: schema.slaInstances.warnAt })
    .from(schema.slaInstances)
    .where(sql`${schema.slaInstances.ticketId} = ${ticketId} and ${schema.slaInstances.metric} = 'resolution'`);

  const now = new Date();
  const end = t.resolvedAt ?? now;
  let slaPts = 0;
  if (slaRow) {
    if (slaRow.state === 'breached') slaPts = w.slaBreached;
    else if (slaRow.state === 'running' && slaRow.warnAt && slaRow.warnAt <= now) slaPts = w.slaWarning;
  }
  const matched = matchKeywords(keywords, t.subject, t.description);
  const keywordPts = matched.reduce((n, k) => n + k.boost, 0);

  // Sentiment from the latest AI triage: upset requesters get a nudge up.
  const [enr] = await tx
    .select({ result: schema.aiEnrichments.result })
    .from(schema.aiEnrichments)
    .where(and(
      eq(schema.aiEnrichments.ticketId, ticketId),
      eq(schema.aiEnrichments.feature, 'triage'),
    ))
    .orderBy(desc(schema.aiEnrichments.createdAt))
    .limit(1);
  const sentiment = ((enr?.result as any)?.sentiment ?? 'neutral') as string;
  const sentimentPts =
    sentiment === 'frustrated' ? w.sentimentFrustrated
    : sentiment === 'urgent' ? w.sentimentUrgent
    : 0;

  // …and SHOUTING gets a nudge down.
  const shouting = isShouting(t.subject, t.description);

  const score =
    (w.priority[String(t.priority)] ?? 0) +
    Math.min(w.agePerBusinessDay * businessDaysBetween(t.createdAt, end), w.ageCap) +
    (t.isVip ? w.vip : 0) +
    slaPts +
    keywordPts +
    sentimentPts -
    (shouting ? w.allCapsPenalty : 0) +
    t.manualBoost;

  await tx.update(schema.tickets).set({
    score,
    customFields: {
      ...((t.customFields as object) ?? {}),
      flaggedKeywords: matched.map((k) => ({ term: k.term, boost: k.boost })),
      sentimentFlag: sentimentPts > 0 ? sentiment : null,
      shouting,
    },
  }).where(eq(schema.tickets.id, ticketId));
  return score;
}
