import type { FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { activeIncidents } from '../services/incidents.js';
import { createTicketCore } from '../services/ticketService.js';
import { requireStaff } from './guards.js';

const { users } = schema;

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
}
