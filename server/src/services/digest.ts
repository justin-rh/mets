import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider, type DigestInput, type DigestResult } from './ai/provider.js';
import { tokens, sharedTokens } from './incidents.js';

const { appConfig, aiUsage } = schema;

/**
 * SOTO's weekly briefing — problem management, not incident response.
 * Same-day bursts become incidents; the digest hunts the slower pattern:
 * the same kind of ticket recurring across WEEKS, volume shifts, SLA and
 * CSAT hotspots, and repeated issues nobody has written a KB article for.
 * All aggregation is deterministic; the AI only writes the briefing.
 */

const PERIOD_DAYS = 30;
const CONFIG_KEY = 'weekly_digest';
const MIN_CLUSTER = 4;
const MIN_DAYS = 2;

type Cluster = DigestInput['clusters'][number];

async function findClusters(): Promise<Cluster[]> {
  const rows = (await db.execute(sql`
    select t.id, t.subject, c.name as category, t.created_at::date as day
    from tickets t
    join categories c on c.id = t.category_id
    where t.created_at > now() - make_interval(days => ${PERIOD_DAYS})
      and t.subject not ilike 'suspected incident:%'
  `)).rows as { id: number; subject: string; category: string; day: string }[];

  // Within each category, group by the dominant shared token — the product
  // or symptom word ("docking", "badge", "scanner") that keeps recurring.
  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    (byCategory.get(r.category) ?? byCategory.set(r.category, []).get(r.category)!).push(r);
  }

  const clusters: Cluster[] = [];
  for (const [category, ticketRows] of byCategory) {
    const byToken = new Map<string, typeof rows>();
    for (const r of ticketRows) {
      for (const w of tokens(r.subject)) {
        (byToken.get(w) ?? byToken.set(w, []).get(w)!).push(r);
      }
    }
    // Best token first; each ticket counts toward one cluster only.
    const claimed = new Set<number>();
    const candidates = [...byToken.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [token, members] of candidates) {
      const fresh = members.filter((m) => !claimed.has(m.id));
      const days = new Set(fresh.map((m) => m.day));
      if (fresh.length < MIN_CLUSTER || days.size < MIN_DAYS) continue;
      fresh.forEach((m) => claimed.add(m.id));
      clusters.push({
        category, token,
        count: fresh.length,
        distinctDays: days.size,
        sampleSubjects: [...new Set(fresh.map((m) => m.subject))].slice(0, 3),
        kbGap: false, // filled below
      });
    }
  }
  clusters.sort((a, b) => b.count - a.count);
  const top = clusters.slice(0, 8);

  // KB gap: does the knowledge base have anything for this cluster?
  const { hybridSearch } = await import('./kb/kbService.js');
  for (const c of top) {
    const hits = await hybridSearch(`${c.token} ${c.sampleSubjects[0] ?? ''}`, 1);
    c.kbGap = hits.length === 0 || hits[0]!.score < 0.02;
  }
  return top;
}

async function aggregate(): Promise<DigestInput> {
  const half = Math.floor(PERIOD_DAYS / 2);
  const trends = (await db.execute(sql`
    select c.name as category,
      count(*) filter (where t.created_at > now() - make_interval(days => ${half})) as recent,
      count(*) filter (where t.created_at <= now() - make_interval(days => ${half})
        and t.created_at > now() - make_interval(days => ${PERIOD_DAYS})) as prior
    from tickets t join categories c on c.id = t.category_id
    where t.created_at > now() - make_interval(days => ${PERIOD_DAYS})
    group by c.name
    having count(*) >= 6
    order by abs(
      count(*) filter (where t.created_at > now() - make_interval(days => ${half}))::numeric
      - count(*) filter (where t.created_at <= now() - make_interval(days => ${half})
          and t.created_at > now() - make_interval(days => ${PERIOD_DAYS}))::numeric
    ) desc
    limit 6
  `)).rows as any[];

  const slaByQueue = (await db.execute(sql`
    select tm.name as queue,
      count(*) filter (where s.breached_at is not null) as breached,
      count(*) as total
    from sla_instances s
    join tickets t on t.id = s.ticket_id
    join teams tm on tm.id = t.queue_id
    where s.metric = 'resolution' and t.created_at > now() - make_interval(days => ${PERIOD_DAYS})
    group by tm.name
    having count(*) filter (where s.breached_at is not null) > 0
    order by 2 desc limit 5
  `)).rows as any[];

  const csatLow = (await db.execute(sql`
    select tm.name as queue, round(avg(t.csat_rating)::numeric, 1) as avg, count(*) as count
    from tickets t join teams tm on tm.id = t.queue_id
    where t.csat_at > now() - make_interval(days => ${PERIOD_DAYS})
    group by tm.name
    having count(*) >= 3 and avg(t.csat_rating) < 3.6
    order by avg(t.csat_rating) asc limit 4
  `)).rows as any[];

  return {
    periodDays: PERIOD_DAYS,
    clusters: await findClusters(),
    categoryTrends: trends.map((t) => ({ category: t.category, recent: Number(t.recent), prior: Number(t.prior) })),
    slaByQueue: slaByQueue.map((s) => ({ queue: s.queue, breached: Number(s.breached), total: Number(s.total) })),
    csatLow: csatLow.map((c) => ({ queue: c.queue, avg: Number(c.avg), count: Number(c.count) })),
  };
}

export type StoredDigest = {
  generatedAt: string;
  periodDays: number;
  result: DigestResult;
};

export async function generateDigest(): Promise<StoredDigest> {
  const input = await aggregate();
  const outcome = await getAIProvider().writeDigest(input);
  await db.insert(aiUsage).values({
    feature: 'digest', model: outcome.model, ticketId: null,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });
  const stored: StoredDigest = {
    generatedAt: new Date().toISOString(),
    periodDays: PERIOD_DAYS,
    result: outcome.result,
  };
  await db.insert(appConfig)
    .values({ key: CONFIG_KEY, value: stored })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: stored, updatedAt: new Date() } });
  return stored;
}

export async function latestDigest(): Promise<StoredDigest | null> {
  const [row] = await db.select({ value: appConfig.value }).from(appConfig)
    .where(eq(appConfig.key, CONFIG_KEY));
  return (row?.value as StoredDigest) ?? null;
}

/** Weekly refresh: regenerate when the stored briefing is older than 6 days. */
export function startDigestSweep(log: (msg: string) => void) {
  const tick = async () => {
    try {
      const current = await latestDigest();
      const age = current ? Date.now() - new Date(current.generatedAt).getTime() : Infinity;
      if (age > 6 * 24 * 3_600_000) {
        await generateDigest();
        log('weekly digest regenerated');
      }
    } catch (e: any) {
      log(`digest sweep failed: ${e?.message ?? e}`);
    }
  };
  setTimeout(tick, 30_000); // shortly after boot, off the startup path
  setInterval(tick, 6 * 3_600_000); // re-check every 6h
}
