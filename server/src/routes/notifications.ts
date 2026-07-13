import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';

const { users } = schema;

export type NotificationPrefs = {
  assignedToMe: boolean;
  slaAlerts: boolean;
  queueActivity: boolean;
  emailReplies: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  assignedToMe: true, slaAlerts: true, queueActivity: true, emailReplies: true,
};

async function prefsFor(userId: number): Promise<NotificationPrefs> {
  const [me] = await db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId));
  return { ...DEFAULT_PREFS, ...((me?.prefs as object) ?? {}) };
}

export async function notificationRoutes(app: FastifyInstance) {
  /**
   * The user's notification feed, derived from audit events (last 7 days):
   * assignments to them, SLA alerts on their tickets, new tickets in their
   * queues, and email replies on their tickets — honoring their prefs and
   * excluding their own actions.
   */
  app.get('/api/notifications', async (req) => {
    const me = req.userId;
    const [meRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, me));
    if (!meRow) return { prefs: DEFAULT_PREFS, items: [] };
    const prefs = await prefsFor(me);

    const rows = (await db.execute(sql`
      select e.id, e.event_type, e.created_at, e.new_value, t.number, t.subject
      from ticket_events e
      join tickets t on t.id = e.ticket_id
      where e.created_at > now() - interval '7 days'
        and e.actor_id is distinct from ${me}
        and (
          (${prefs.assignedToMe} and e.event_type = 'assigned'
            and t.assignee_id = ${me} and e.new_value = ${meRow.name})
          or (${prefs.slaAlerts} and e.event_type in ('sla_warning', 'sla_breached')
            and t.assignee_id = ${me})
          or (${prefs.queueActivity} and e.event_type = 'created'
            and t.queue_id in (select team_id from team_memberships where user_id = ${me}))
          or (${prefs.emailReplies} and e.event_type = 'email_reply'
            and t.assignee_id = ${me})
        )
      order by e.created_at desc
      limit 30
    `)).rows as any[];

    return {
      prefs,
      items: rows.map((r) => ({
        id: Number(r.id),
        type: r.event_type as string,
        number: r.number as string,
        subject: r.subject as string,
        at: r.created_at as string,
      })),
    };
  });

  app.put('/api/me/notification-prefs', async (req) => {
    const prefs = z.object({
      assignedToMe: z.boolean(),
      slaAlerts: z.boolean(),
      queueActivity: z.boolean(),
      emailReplies: z.boolean(),
    }).parse(req.body);
    await db.update(users).set({ notificationPrefs: prefs }).where(eq(users.id, req.userId));
    return { ok: true };
  });
}
