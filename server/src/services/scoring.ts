import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type Weights = {
  priority: Record<string, number>;
  agePerBusinessDay: number;
  ageCap: number;
  vip: number;
  slaWarning: number;
  slaBreached: number;
};

const DEFAULT_WEIGHTS: Weights = {
  priority: { '1': 40, '2': 25, '3': 12, '4': 5 },
  agePerBusinessDay: 2, ageCap: 20, vip: 15, slaWarning: 10, slaBreached: 25,
};

let cache: { weights: Weights; at: number } | null = null;

/** Drop the cached weights so admin edits take effect immediately. */
export function invalidateScoreWeightsCache() {
  cache = null;
}

export async function getScoreWeights(): Promise<Weights> {
  if (cache && Date.now() - cache.at < 60_000) return cache.weights;
  const [row] = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, 'score_weights'));
  const weights = row ? ({ ...DEFAULT_WEIGHTS, ...(row.value as object) } as Weights) : DEFAULT_WEIGHTS;
  cache = { weights, at: Date.now() };
  return weights;
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
  const [t] = await tx
    .select({
      priority: schema.tickets.priority,
      createdAt: schema.tickets.createdAt,
      resolvedAt: schema.tickets.resolvedAt,
      manualBoost: schema.tickets.manualBoost,
      isVip: schema.users.isVip,
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
  const score =
    (w.priority[String(t.priority)] ?? 0) +
    Math.min(w.agePerBusinessDay * businessDaysBetween(t.createdAt, end), w.ageCap) +
    (t.isVip ? w.vip : 0) +
    slaPts +
    t.manualBoost;

  await tx.update(schema.tickets).set({ score }).where(eq(schema.tickets.id, ticketId));
  return score;
}
