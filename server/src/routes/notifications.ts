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
  watchedTickets: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  assignedToMe: true, slaAlerts: true, queueActivity: true, emailReplies: true,
  watchedTickets: true,
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
      select 'e' || e.id as id, e.event_type, e.created_at, t.number, t.subject
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
          or (${prefs.watchedTickets}
            and e.ticket_id in (select ticket_id from ticket_watchers where user_id = ${me}))
        )
      union all
      -- comments aren't audit events; watchers hear about those too
      select 'c' || c.id as id, 'watched_comment' as event_type, c.created_at, t.number, t.subject
      from ticket_comments c
      join tickets t on t.id = c.ticket_id
      where ${prefs.watchedTickets}
        and c.created_at > now() - interval '7 days'
        and c.author_id is distinct from ${me}
        and c.ticket_id in (select ticket_id from ticket_watchers where user_id = ${me})
      order by created_at desc
      limit 30
    `)).rows as any[];

    return {
      prefs,
      items: rows.map((r) => ({
        id: r.id as string,
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
      watchedTickets: z.boolean().default(true),
    }).parse(req.body);
    await db.update(users).set({ notificationPrefs: prefs }).where(eq(users.id, req.userId));
    return { ok: true };
  });
}
