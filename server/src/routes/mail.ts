import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { mailboxFor, processInboundEmail } from '../services/mail/mockMail.js';
import { requireStaff, requireStaffRead } from './guards.js';

export async function mailRoutes(app: FastifyInstance) {
  // The mock transport: in production this is the Graph webhook + poller.
  app.post('/api/mail/inbound', async (req) => {
    requireStaff(req);
    const body = z.object({
      from: z.string().email(),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20_000),
    }).parse(req.body);
    return processInboundEmail(body);
  });

  app.get('/api/mail/mailbox', async (req) => {
    requireStaffRead(req);
    const q = z.object({ email: z.string().email() }).parse(req.query);
    return mailboxFor(q.email);
  });

  // Outbound notifications sent to an address (queue-entry emails, etc.).
  app.get('/api/mail/outbound', async (req) => {
    requireStaffRead(req);
    const q = z.object({ email: z.string().email() }).parse(req.query);
    const { mailOutbound, tickets } = schema;
    return db
      .select({
        id: mailOutbound.id, subject: mailOutbound.subject, body: mailOutbound.body,
        kind: mailOutbound.kind, createdAt: mailOutbound.createdAt,
        deliveredAt: mailOutbound.deliveredAt, deliveryError: mailOutbound.deliveryError,
        ticketNumber: tickets.number,
      })
      .from(mailOutbound)
      .leftJoin(tickets, eq(tickets.id, mailOutbound.ticketId))
      .where(eq(mailOutbound.toEmail, q.email.trim().toLowerCase()))
      .orderBy(desc(mailOutbound.id))
      .limit(20);
  });

  // All requesters for the simulator's From picker (the datalist filters
  // as you type, so the full directory is fine).
  app.get('/api/mail/senders', async (req) => {
    requireStaffRead(req);
    const rows = await db
      .select({ name: schema.users.name, email: schema.users.email, department: schema.users.department })
      .from(schema.users)
      .where(eq(schema.users.role, 'requester'))
      .orderBy(asc(schema.users.name));
    return rows;
  });
}
