import { and, eq, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createTicketCore } from './ticketService.js';

const { recurringTickets } = schema;

export function advance(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    default: d.setDate(d.getDate() + 7);
  }
  return d;
}

/**
 * File due recurring definitions through the normal intake pipeline —
 * routing rules, SLA attachment, AI triage — exactly like a hand-typed
 * ticket, then advance next_run_at. Advancing FIRST makes a crashed run
 * skip rather than double-file (safe default for maintenance chores).
 */
export async function recurringSweep(log: (msg: string) => void) {
  const due = await db.select().from(recurringTickets)
    .where(and(eq(recurringTickets.enabled, true), lte(recurringTickets.nextRunAt, new Date())))
    .limit(10);
  let created = 0;
  for (const r of due) {
    // advance past now even if the schedule was long overdue (e.g. seeded
    // in the past) so it doesn't fire repeatedly to catch up
    let next = advance(r.nextRunAt, r.frequency);
    while (next <= new Date()) next = advance(next, r.frequency);
    await db.update(recurringTickets)
      .set({ nextRunAt: next, lastRunAt: new Date() })
      .where(eq(recurringTickets.id, r.id));

    const ticket = await createTicketCore({
      subject: r.subject,
      description: `${r.description}\n\n— Filed automatically by the recurring schedule "${r.name}" (${r.frequency}).`,
      type: r.type,
      requesterId: r.requesterId,
      source: 'api',
    });
    const { enrichTicket } = await import('./ai/enrichment.js');
    enrichTicket(ticket.id, 'auto').catch(() => {});
    created++;
    log(`recurring: "${r.name}" filed ${ticket.number}, next run ${next.toISOString().slice(0, 10)}`);
  }
  return created;
}

export function startRecurringSweep(log: (msg: string) => void, intervalMs = 5 * 60_000) {
  const run = () => recurringSweep(log).catch((err) => log(`recurring sweep failed: ${err.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
