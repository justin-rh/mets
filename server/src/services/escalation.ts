import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { autoAssign, autoAssignByExpertise } from './ticketService.js';
import { getBotUser } from './templates.js';

const { appConfig, ticketEvents, teamMemberships, chatMessages, users, teams } = schema;

export type EscalationConfig = {
  enabled: boolean;
  minutesByPriority: Record<string, number>;
  expertiseScoreThreshold: number;
};

const DEFAULTS: EscalationConfig = {
  enabled: false, // seeded backlog is days old — enabling is an admin choice
  minutesByPriority: { '1': 30, '2': 120, '3': 480, '4': 1440 },
  expertiseScoreThreshold: 70,
};

export async function getEscalationConfig(): Promise<EscalationConfig> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'escalation'));
  return { ...DEFAULTS, ...((row?.value as object) ?? {}) };
}

/**
 * Escalate stale unassigned tickets: anything sitting unassigned past its
 * priority's threshold gets auto-assigned — by expertise when the score says
 * it matters (best person), round-robin otherwise (fastest hands) — and the
 * queue lead gets one SOTO Bot chat summary per sweep. Each ticket escalates
 * exactly once (audited 'escalated' event). Approval-parked and snoozed
 * tickets are left alone.
 */
export async function escalationSweep(log: (msg: string) => void) {
  const cfg = await getEscalationConfig();
  if (!cfg.enabled) return { escalated: 0, byExpertise: 0, roundRobin: 0, unfilled: 0 };

  const cases = Object.entries(cfg.minutesByPriority)
    .map(([p, m]) => `when ${Number(p)} then ${Number(m)}`).join(' ');
  const stale = (await db.execute(sql`
    select t.id, t.number, t.priority, t.score, t.queue_id, t.created_at
    from tickets t
    join statuses s on s.id = t.status_id
    where t.assignee_id is null
      and s.category in ('new', 'open')
      and (t.snoozed_until is null or t.snoozed_until <= now())
      and t.created_at < now() - make_interval(mins => (case t.priority ${sql.raw(cases)} else 1440 end))
      and not exists (
        select 1 from ticket_events e
        where e.ticket_id = t.id and e.event_type = 'escalated'
      )
    order by t.score desc
    limit 25
  `)).rows as { id: number; number: string; priority: number; score: number; queue_id: number; created_at: string }[];
  if (stale.length === 0) return { escalated: 0, byExpertise: 0, roundRobin: 0, unfilled: 0 };

  type Outcome = {
    number: string; queueId: number; method: string;
    assigneeName: string | null; fit?: number; minutes: number;
  };
  const outcomes: Outcome[] = [];
  let byExpertise = 0, roundRobin = 0, unfilled = 0;

  for (const t of stale) {
    const id = Number(t.id);
    const minutes = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60_000);
    const wantExpertise = Number(t.score) >= cfg.expertiseScoreThreshold;

    let method = wantExpertise ? 'expertise' : 'round_robin';
    let assigneeName: string | null = null;
    let fit: number | undefined;

    if (wantExpertise) {
      const [r] = await autoAssignByExpertise([id], { id: null, type: 'system' });
      if (r?.assigneeId) {
        assigneeName = r.assigneeName ?? null;
        fit = r.fit;
        byExpertise++;
      } else {
        method = 'round_robin (no skilled agent)';
      }
    }
    if (!assigneeName) {
      const [r] = await autoAssign([id], { id: null, type: 'system' });
      if (r?.assigneeId) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, r.assigneeId));
        assigneeName = u?.name ?? null;
        roundRobin++;
      }
    }
    if (!assigneeName) {
      method = 'unfilled';
      unfilled++;
    }

    await db.insert(ticketEvents).values({
      ticketId: id, actorId: null, actorType: 'system', eventType: 'escalated',
      field: method,
      oldValue: `unassigned ${minutes}m (P${t.priority}, score ${t.score})`,
      newValue: assigneeName
        ? `${assigneeName}${fit != null ? ` · ${Math.round(fit * 100)}% fit` : ''}`
        : 'no agent available',
    });
    outcomes.push({ number: t.number, queueId: Number(t.queue_id), method, assigneeName, fit, minutes });
  }

  // One chat summary per queue lead, from SOTO Bot.
  const bot = await getBotUser();
  const byQueue = new Map<number, Outcome[]>();
  for (const o of outcomes) (byQueue.get(o.queueId) ?? byQueue.set(o.queueId, []).get(o.queueId)!).push(o);
  for (const [queueId, list] of byQueue) {
    const [lead] = await db
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, queueId), eq(teamMemberships.role, 'lead')));
    if (!lead) continue;
    const [queue] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, queueId));
    const lines = list.map((o) =>
      `${o.number} (unassigned ${o.minutes >= 60 ? `${Math.round(o.minutes / 60)}h` : `${o.minutes}m`}) → ${
        o.assigneeName ? `${o.assigneeName}${o.fit != null ? ` (${Math.round(o.fit * 100)}% fit)` : ''}` : '⚠ NO AGENT AVAILABLE'
      }`);
    await db.insert(chatMessages).values({
      fromId: bot.id, toId: lead.userId,
      body: `⚠ Escalation sweep — ${list.length} ticket${list.length === 1 ? '' : 's'} in ${queue?.name ?? 'your queue'} sat unassigned past threshold:\n${lines.join('\n')}\n(automated — replies aren't monitored)`,
    });
  }

  log(`escalation: ${outcomes.length} escalated (${byExpertise} expertise, ${roundRobin} round-robin, ${unfilled} unfilled)`);
  return { escalated: outcomes.length, byExpertise, roundRobin, unfilled };
}

export function startEscalationSweep(log: (msg: string) => void, intervalMs = 5 * 60_000) {
  const run = () => escalationSweep(log).catch((err) => log(`escalation sweep failed: ${err.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
