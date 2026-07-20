import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireStaff, requireStaffRead } from './guards.js';

const { chatMessages, users } = schema;

/** Agent DMs. Client polls conversations + the open thread on an interval. */
export async function chatRoutes(app: FastifyInstance) {
  // Every partner I've ever messaged with: last message preview + unread count.
  app.get('/api/chat/conversations', async (req) => {
    requireStaffRead(req);
    const rows = (await db.execute(sql`
      with pairs as (
        select case when from_id = ${req.userId} then to_id else from_id end as partner_id,
               m.id, m.from_id, m.body, m.created_at, m.read_at
        from chat_messages m
        where from_id = ${req.userId} or to_id = ${req.userId}
      )
      select p.partner_id,
             u.name as partner_name,
             u.is_available,
             (select count(*) from chat_messages um
               where um.from_id = p.partner_id and um.to_id = ${req.userId} and um.read_at is null) as unread,
             (select body from pairs lp where lp.partner_id = p.partner_id order by lp.id desc limit 1) as last_body,
             (select from_id from pairs lp where lp.partner_id = p.partner_id order by lp.id desc limit 1) as last_from_id,
             max(p.id) as last_id,
             max(p.created_at) as last_at
      from pairs p
      join users u on u.id = p.partner_id
      group by p.partner_id, u.name, u.is_available
      order by max(p.id) desc
    `)).rows as any[];
    return rows.map((r) => ({
      partnerId: Number(r.partner_id),
      partnerName: r.partner_name,
      isAvailable: r.is_available,
      unread: Number(r.unread),
      lastBody: r.last_body,
      lastFromMe: Number(r.last_from_id) === req.userId,
      lastId: Number(r.last_id),
      lastAt: r.last_at,
    }));
  });

  // Thread with one user, oldest first. ?markRead=1 while the thread is on
  // screen so reading is what clears the badge.
  app.get('/api/chat/with/:userId', async (req) => {
    requireStaffRead(req);
    const partnerId = z.coerce.number().parse((req.params as any).userId);
    const markRead = (req.query as any)?.markRead === '1';
    if (markRead) {
      await db.update(chatMessages).set({ readAt: new Date() }).where(and(
        eq(chatMessages.fromId, partnerId), eq(chatMessages.toId, req.userId),
        isNull(chatMessages.readAt),
      ));
    }
    return db.select().from(chatMessages)
      .where(or(
        and(eq(chatMessages.fromId, req.userId), eq(chatMessages.toId, partnerId)),
        and(eq(chatMessages.fromId, partnerId), eq(chatMessages.toId, req.userId)),
      ))
      .orderBy(asc(chatMessages.id))
      .limit(200);
  });

  app.post('/api/chat/with/:userId', async (req, reply) => {
    requireStaff(req);
    const partnerId = z.coerce.number().parse((req.params as any).userId);
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    if (partnerId === req.userId) return reply.status(400).send({ error: 'that way lies madness' });
    const [partner] = await db.select({ id: users.id, role: users.role }).from(users)
      .where(eq(users.id, partnerId));
    if (!partner || partner.role === 'readonly') {
      return reply.status(400).send({ error: 'no such chat partner' });
    }
    const [msg] = await db.insert(chatMessages).values({
      fromId: req.userId, toId: partnerId, body: body.body,
    }).returning();
    return msg;
  });

  // Chat is where work hides: one click turns the tail of a conversation
  // into a real ticket. The chat partner becomes the requester (it's their
  // issue being discussed), the agent is the submitter, and the transcript
  // rides as the description — AI triage routes and titles it like any
  // other ticket. A confirmation message lands back in the thread (ticket
  // numbers linkify there).
  app.post('/api/chat/with/:userId/to-ticket', async (req, reply) => {
    requireStaff(req);
    const partnerId = z.coerce.number().parse((req.params as any).userId);

    const recent = await db
      .select({
        fromId: chatMessages.fromId, body: chatMessages.body,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(or(
        and(eq(chatMessages.fromId, req.userId), eq(chatMessages.toId, partnerId)),
        and(eq(chatMessages.fromId, partnerId), eq(chatMessages.toId, req.userId)),
      ))
      .orderBy(desc(chatMessages.id))
      .limit(10);
    if (recent.length === 0) return reply.status(400).send({ error: 'no messages to convert' });

    // "Recent" means this conversation, not the whole history: keep only
    // messages within an hour of the newest so an old unrelated exchange
    // doesn't ride into the ticket.
    const newestAt = recent[0]!.createdAt.getTime();
    const windowed = recent.filter((m) => newestAt - m.createdAt.getTime() <= 60 * 60_000);

    const [meRow] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.userId));
    const [partner] = await db.select({ name: users.name }).from(users).where(eq(users.id, partnerId));
    if (!partner) return reply.status(400).send({ error: 'no such chat partner' });
    const nameOf = (fromId: number) => (fromId === req.userId ? meRow?.name ?? 'Agent' : partner.name);

    const transcript = windowed.reverse()
      .map((m) => `> **${nameOf(m.fromId)}:** ${m.body.slice(0, 500)}`)
      .join('\n');
    const description = `${transcript}\n\n*Filed from an agent chat between ${meRow?.name ?? 'an agent'} and ${partner.name}.*`;

    const { createTicketCore } = await import('../services/ticketService.js');
    const created = await createTicketCore({
      subject: `Chat with ${partner.name}`, // vague on purpose — AI titles it from the transcript
      description,
      requesterId: partnerId,
      submittedById: req.userId,
      source: 'agent',
    });

    // Triage off the request path, same as the portal create route.
    const { enrichTicket } = await import('../services/ai/enrichment.js');
    void enrichTicket(created.id, 'auto').catch(() => {});

    // Confirmation into the thread — the T-number linkifies client-side.
    await db.insert(chatMessages).values({
      fromId: req.userId, toId: partnerId,
      body: `📎 Turned our recent messages into ${created.number} — tracking it there.`,
    });

    return { id: created.id, number: created.number };
  });
}
