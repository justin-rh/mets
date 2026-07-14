import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { applyTicketChanges } from './ticketService.js';

const { appConfig, statuses } = schema;

const DEFAULT_DAYS = 7;

/** Days a ticket sits in Resolved before auto-closing; 0 disables. */
export async function getAutoCloseDays(): Promise<number> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'auto_close'));
  const days = Number((row?.value as any)?.days);
  return Number.isFinite(days) ? days : DEFAULT_DAYS;
}

/**
 * Close tickets that have been Resolved for longer than the configured
 * window — the promise SOTO Bot's closing note makes. Goes through
 * applyTicketChanges so each close is an audited system event and closed_at
 * is stamped; a requester reply still reopens afterwards.
 */
export async function autoCloseSweep(log: (msg: string) => void): Promise<number> {
  const days = await getAutoCloseDays();
  if (days <= 0) return 0;

  const [closedStatus] = await db.select().from(statuses)
    .where(eq(statuses.category, 'closed')).orderBy(asc(statuses.position)).limit(1);
  if (!closedStatus) return 0;

  const rows = (await db.execute(sql`
    select t.id from tickets t
    join statuses s on s.id = t.status_id
    where s.category = 'resolved'
      and t.resolved_at < now() - make_interval(days => ${days})
    limit 100
  `)).rows as { id: number }[];

  for (const r of rows) {
    await applyTicketChanges(Number(r.id), { id: null, type: 'system' }, { statusId: closedStatus.id });
  }
  if (rows.length > 0) log(`auto-close: closed ${rows.length} ticket(s) resolved > ${days}d ago`);
  return rows.length;
}

export function startAutoCloseSweep(log: (msg: string) => void, intervalMs = 10 * 60_000) {
  const run = () => autoCloseSweep(log).catch((err) => log(`auto-close sweep failed: ${err.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
