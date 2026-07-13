import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { recomputeScore } from '../scoring.js';
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from './businessTime.js';

const { slaPolicies, slaInstances, ticketEvents, appConfig } = schema;

type Tx = typeof db;
type StatusCategory = 'new' | 'open' | 'pending' | 'resolved' | 'closed';

const DEFAULT_CAL: BusinessCalendar = {
  timezone: 'America/Phoenix', days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00',
};

let calCache: { cal: BusinessCalendar; at: number } | null = null;

export async function getCalendar(): Promise<BusinessCalendar> {
  if (calCache && Date.now() - calCache.at < 60_000) return calCache.cal;
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'business_hours'));
  const cal = row ? ({ ...DEFAULT_CAL, ...(row.value as object) } as BusinessCalendar) : DEFAULT_CAL;
  calCache = { cal, at: Date.now() };
  return cal;
}

const WARN_AT_FRACTION = 0.75; // warn when 75% of the window is spent

/** Attach SLA instances to a new ticket based on its priority. */
export async function attachSlas(tx: Tx, ticketId: number, priority: number, startAt = new Date()) {
  const cal = await getCalendar();
  const policies = await tx.select().from(slaPolicies).where(eq(slaPolicies.enabled, true));
  const policy = policies.find((p) => (p.conditions as any)?.priority === priority);
  if (!policy) return;

  const rows: (typeof slaInstances.$inferInsert)[] = [];
  const metrics: ['first_response' | 'resolution', number | null][] = [
    ['first_response', policy.firstResponseMinutes],
    ['resolution', policy.resolutionMinutes],
  ];
  for (const [metric, minutes] of metrics) {
    if (!minutes) continue;
    rows.push({
      ticketId, policyId: policy.id, metric, state: 'running',
      startedAt: startAt,
      targetAt: addBusinessMinutes(startAt, minutes, cal),
      warnAt: addBusinessMinutes(startAt, minutes * WARN_AT_FRACTION, cal),
    });
  }
  if (rows.length) await tx.insert(slaInstances).values(rows);
}

/**
 * React to a status-category transition. Pending pauses the clocks;
 * leaving pending shifts deadlines forward by the paused business time;
 * resolved/closed completes; reopening resumes with the resolved period
 * treated as a pause (resume, never reset).
 */
export async function onStatusCategoryChange(tx: Tx, ticketId: number, from: StatusCategory, to: StatusCategory) {
  const now = new Date();
  const cal = await getCalendar();
  const active = (states: string[]) =>
    tx.select().from(slaInstances).where(and(
      eq(slaInstances.ticketId, ticketId),
      inArray(slaInstances.state, states as any),
    ));

  const entersPending = to === 'pending' && from !== 'pending';
  const leavesPending = from === 'pending' && to !== 'pending' && to !== 'resolved' && to !== 'closed';
  const resolves = (to === 'resolved' || to === 'closed') && from !== 'resolved' && from !== 'closed';
  const reopens = (from === 'resolved' || from === 'closed') && to !== 'resolved' && to !== 'closed';

  if (entersPending) {
    await tx.update(slaInstances)
      .set({ state: 'paused', pausedAt: now })
      .where(and(eq(slaInstances.ticketId, ticketId), eq(slaInstances.state, 'running')));
  }

  if (leavesPending) {
    for (const inst of await active(['paused'])) {
      if (!inst.pausedAt) continue;
      const pausedMin = businessMinutesBetween(inst.pausedAt, now, cal);
      await tx.update(slaInstances).set({
        state: 'running',
        pausedAt: null,
        accumulatedPausedSeconds: inst.accumulatedPausedSeconds + Math.round(pausedMin * 60),
        targetAt: addBusinessMinutes(inst.targetAt, pausedMin, cal),
        // shift the warning threshold too, unless it already fired
        ...(inst.warnAt && !inst.warnedAt
          ? { warnAt: addBusinessMinutes(inst.warnAt, pausedMin, cal) }
          : {}),
      }).where(eq(slaInstances.id, inst.id));
    }
  }

  if (resolves) {
    for (const inst of await active(['running', 'paused'])) {
      await tx.update(slaInstances).set({
        state: 'completed',
        completedAt: now,
        pausedAt: null,
        breachedAt: inst.breachedAt ?? (now > inst.targetAt ? inst.targetAt : null),
      }).where(eq(slaInstances.id, inst.id));
    }
  }

  if (reopens) {
    // Resume the resolution clock; the resolved period counts as a pause.
    const [inst] = await tx.select().from(slaInstances).where(and(
      eq(slaInstances.ticketId, ticketId),
      eq(slaInstances.metric, 'resolution'),
      eq(slaInstances.state, 'completed'),
    ));
    if (inst?.completedAt) {
      const gapMin = businessMinutesBetween(inst.completedAt, now, cal);
      const newTarget = addBusinessMinutes(inst.targetAt, gapMin, cal);
      await tx.update(slaInstances).set({
        state: 'running',
        completedAt: null,
        targetAt: newTarget,
        breachedAt: null, // sweep re-breaches if still past target
      }).where(eq(slaInstances.id, inst.id));
    }
  }
}

/** Retarget active instances after a priority change; elapsed time carries over. */
export async function onPriorityChange(tx: Tx, ticketId: number, newPriority: number) {
  const now = new Date();
  const cal = await getCalendar();
  const policies = await tx.select().from(slaPolicies).where(eq(slaPolicies.enabled, true));
  const policy = policies.find((p) => (p.conditions as any)?.priority === newPriority);
  if (!policy) return;

  const instances = await tx.select().from(slaInstances).where(and(
    eq(slaInstances.ticketId, ticketId),
    inArray(slaInstances.state, ['running', 'paused'] as any),
  ));
  for (const inst of instances) {
    const minutes = inst.metric === 'first_response' ? policy.firstResponseMinutes : policy.resolutionMinutes;
    if (!minutes) continue;
    const elapsed = Math.max(
      0,
      businessMinutesBetween(inst.startedAt, now, cal) - inst.accumulatedPausedSeconds / 60,
    );
    const remaining = Math.max(0, minutes - elapsed);
    const remainingToWarn = Math.max(0, minutes * WARN_AT_FRACTION - elapsed);
    await tx.update(slaInstances).set({
      policyId: policy.id,
      targetAt: addBusinessMinutes(now, remaining, cal),
      warnAt: inst.warnedAt ? inst.warnAt : addBusinessMinutes(now, remainingToWarn, cal),
    }).where(eq(slaInstances.id, inst.id));
  }
}

/** Complete the first-response clock (first public agent reply). */
export async function completeFirstResponse(ticketId: number, at = new Date()) {
  const [inst] = await db.select().from(slaInstances).where(and(
    eq(slaInstances.ticketId, ticketId),
    eq(slaInstances.metric, 'first_response'),
    inArray(slaInstances.state, ['running', 'paused'] as any),
  ));
  if (!inst) return;
  await db.update(slaInstances).set({
    state: 'completed',
    completedAt: at,
    pausedAt: null,
    breachedAt: at > inst.targetAt ? inst.targetAt : null,
  }).where(eq(slaInstances.id, inst.id));
}

// ---------------------------------------------------------------------------
// The sweep: one indexed query a minute. Warnings fire once (warned_at guard),
// breaches flip state, both land in the audit trail and bump the score so
// breached tickets climb the queue.
// ---------------------------------------------------------------------------

export async function slaSweep(log?: (msg: string) => void) {
  const now = new Date();

  const warned = await db.update(slaInstances)
    .set({ warnedAt: now })
    .where(and(
      eq(slaInstances.state, 'running'),
      isNull(slaInstances.warnedAt),
      lte(slaInstances.warnAt, now),
      sql`${slaInstances.targetAt} > ${now}`,
    ))
    .returning({ ticketId: slaInstances.ticketId, metric: slaInstances.metric, targetAt: slaInstances.targetAt });

  const breached = await db.update(slaInstances)
    .set({ state: 'breached', breachedAt: sql`target_at`, warnedAt: sql`coalesce(warned_at, now())` })
    .where(and(eq(slaInstances.state, 'running'), lte(slaInstances.targetAt, now)))
    .returning({ ticketId: slaInstances.ticketId, metric: slaInstances.metric });

  for (const w of warned) {
    await db.insert(ticketEvents).values({
      ticketId: w.ticketId, actorType: 'system', eventType: 'sla_warning',
      field: w.metric, newValue: `target ${w.targetAt.toISOString()}`,
    });
  }
  for (const b of breached) {
    await db.insert(ticketEvents).values({
      ticketId: b.ticketId, actorType: 'system', eventType: 'sla_breached', field: b.metric,
    });
  }

  const affected = [...new Set([...warned, ...breached].map((r) => r.ticketId))];
  for (const ticketId of affected) await recomputeScore(db, ticketId);

  if (affected.length && log) {
    log(`sla sweep: ${warned.length} warned, ${breached.length} breached`);
  }
  return { warned: warned.length, breached: breached.length };
}

export function startSlaSweep(log: (msg: string) => void, intervalMs = 60_000) {
  const run = () => slaSweep(log).catch((err) => log(`sla sweep failed: ${err.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
