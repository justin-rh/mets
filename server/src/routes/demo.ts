import type { FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { activeIncidents } from '../services/incidents.js';
import { createTicketCore } from '../services/ticketService.js';
import { requireStaff } from './guards.js';

const { users, tickets, ticketComments, ticketEvents, statuses, teams, categories } = schema;

const MONITOR_HISTORY_SUBJECT = 'Second monitor goes black — only the mouse cursor shows';

// The same Zoom-outage burst the incident-demo script files — three similar
// reports from three requesters, which SOTO correlates into a suspected
// incident within a few minutes.
const BURST = [
  ['Zoom meetings will not connect', 'Zoom errors out with code 5003 when joining any meeting. Restarted, no luck.'],
  ['Zoom call failed to connect', 'Every Zoom meeting fails to connect this morning with error 5003. Have a customer call at 10.'],
  ['Zoom down for our standup', 'Zoom client stuck on connecting for our whole team standup. Nobody could join.'],
] as const;

export async function demoRoutes(app: FastifyInstance) {
  // One-click outage simulation for demos: files the burst and lets the
  // normal pipeline do the rest (triage → correlation → banner).
  app.post('/api/demo/incident', async (req, reply) => {
    requireStaff(req);

    const open = await activeIncidents();
    if (open.length > 0) {
      return reply.status(409).send({
        error: `An incident is already active (${open[0]!.number}) — resolve it to run the demo again.`,
      });
    }
    // Double-click guard for the brewing window before declaration.
    const brewing = await db.execute(sql`
      select t.id from tickets t
      join statuses s on s.id = t.status_id
      where t.subject = ${BURST[0]![0]} and s.category not in ('resolved', 'closed')
      limit 1`);
    if (brewing.rows.length > 0) {
      return reply.status(409).send({
        error: 'The demo outage is already brewing — SOTO declares the incident within a few minutes.',
      });
    }

    const requesters = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.role, 'requester'))
      .orderBy(asc(users.id))
      .limit(BURST.length);
    if (requesters.length < BURST.length) {
      return reply.status(500).send({ error: 'not enough requester users seeded' });
    }

    const numbers: string[] = [];
    for (const [i, [subject, description]] of BURST.entries()) {
      const t = await createTicketCore({
        subject, description, type: 'incident',
        requesterId: requesters[i]!.id, source: 'portal',
      });
      numbers.push(t.number);
      const { enrichTicket } = await import('../services/ai/enrichment.js');
      enrichTicket(t.id, 'auto').catch(() => {});
    }
    return { filed: numbers };
  });

  // Plants the institutional-memory demo history: a month-old RESOLVED
  // ticket with the same symptom as the fresh demo ticket, fixed by the
  // calling agent's own comment (DisplayLink driver). Backdating requires
  // direct inserts — the normal create path stamps "now". The ticket is
  // embedded immediately so similar-ticket search and 💡 Suggest fix can
  // cite it without waiting for a boot sweep. Idempotent per reset.
  app.post('/api/demo/monitor-history', async (req) => {
    requireStaff(req);

    const [existing] = await db.select({ number: tickets.number }).from(tickets)
      .where(eq(tickets.subject, MONITOR_HISTORY_SUBJECT));
    if (existing) return { number: existing.number, existing: true };

    const [resolved] = await db.select().from(statuses)
      .where(eq(statuses.category, 'resolved')).orderBy(asc(statuses.position)).limit(1);
    const [queue] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, 'it-support'));
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, 'Hardware'));
    const [requester] = await db.select({ id: users.id, name: users.name }).from(users)
      .where(eq(users.role, 'requester')).orderBy(asc(users.id)).offset(7).limit(1);
    if (!resolved || !queue || !requester) {
      throw Object.assign(new Error('seed data missing (status/queue/requester)'), { statusCode: 500 });
    }

    const DAY = 86_400_000;
    const createdAt = new Date(Date.now() - 32 * DAY);
    const respondedAt = new Date(createdAt.getTime() + 3 * 3_600_000);
    const resolvedAt = new Date(createdAt.getTime() + 26 * 3_600_000);

    const [t] = await db.insert(tickets).values({
      subject: MONITOR_HISTORY_SUBJECT,
      description: 'My second monitor keeps going black — the screen is dark but the mouse cursor still shows up on it when I move over. The other monitor works fine. Started after the Windows update this week. Both are plugged into the docking station.',
      type: 'incident', priority: 3, source: 'portal',
      statusId: resolved.id, queueId: queue.id, categoryId: category?.id ?? null,
      requesterId: requester.id,
      createdAt, updatedAt: resolvedAt, firstRespondedAt: respondedAt, resolvedAt,
    }).returning();

    await db.insert(ticketEvents).values([
      { ticketId: t!.id, actorId: requester.id, actorType: 'user', eventType: 'created', createdAt },
      {
        ticketId: t!.id, actorId: req.userId, actorType: 'user', eventType: 'status_changed',
        field: 'status', oldValue: 'Open', newValue: resolved.name, createdAt: resolvedAt,
      },
    ]);
    await db.insert(ticketComments).values([
      {
        ticketId: t!.id, authorId: req.userId, visibility: 'public', source: 'agent',
        bodyText: `Figured it out — that monitor runs through the dock's DisplayLink adapter, and the Windows update wiped its driver (classic symptom: black screen but the cursor still renders). Downloaded the DisplayLink driver from displaylink.com/downloads, installed, rebooted — monitor came straight back. Marking this resolved.`,
        createdAt: resolvedAt,
      },
      {
        ticketId: t!.id, authorId: requester.id, visibility: 'public', source: 'portal',
        bodyText: 'That did it — both monitors working again. Thank you!',
        createdAt: new Date(resolvedAt.getTime() + 40 * 60_000),
      },
    ]);

    // Straight into the semantic memory — no waiting for the boot sweep.
    const { embedTicket } = await import('../services/kb/kbService.js');
    await embedTicket(t!.id).catch(() => {});

    return { number: t!.number, requester: requester.name };
  });
}
