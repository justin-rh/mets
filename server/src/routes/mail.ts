import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { mailboxFor, processInboundEmail } from '../services/mail/mockMail.js';

export async function mailRoutes(app: FastifyInstance) {
  // The mock transport: in production this is the Graph webhook + poller.
  app.post('/api/mail/inbound', async (req) => {
    const body = z.object({
      from: z.string().email(),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20_000),
    }).parse(req.body);
    return processInboundEmail(body);
  });

  app.get('/api/mail/mailbox', async (req) => {
    const q = z.object({ email: z.string().email() }).parse(req.query);
    return mailboxFor(q.email);
  });

  // Sample senders for the simulator's From picker.
  app.get('/api/mail/senders', async () => {
    const rows = await db
      .select({ name: schema.users.name, email: schema.users.email, department: schema.users.department })
      .from(schema.users)
      .where(eq(schema.users.role, 'requester'))
      .orderBy(asc(schema.users.name))
      .limit(12);
    return rows;
  });
}
