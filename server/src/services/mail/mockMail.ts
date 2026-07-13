// Mock mail adapter: exercises the production email design (subject-token
// threading, guest contacts, auto-ack, reopen-on-reply) against real tickets.
// The Graph adapter replaces the transport; this pipeline stays.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { enrichTicket } from '../ai/enrichment.js';
import { applyTicketChanges, createTicketCore } from '../ticketService.js';

const { tickets, ticketComments, ticketEvents, users, statuses, categories } = schema;

const SUBJECT_TOKEN = /\[(T-\d{7})\]/;
const HELPDESK = 'helpdesk@masterelectronics.com';

async function findOrCreateSender(email: string) {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized));
  if (existing) return existing;
  // Unknown sender → guest contact (production policy per design doc §6.5).
  const name = normalized.split('@')[0]!
    .split(/[._-]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || 'Guest';
  const [guest] = await db.insert(users).values({
    name, email: normalized, role: 'requester', department: null,
  }).returning();
  return guest!;
}

export async function processInboundEmail(input: { from: string; subject: string; body: string }) {
  const sender = await findOrCreateSender(input.from);
  const token = input.subject.match(SUBJECT_TOKEN)?.[1];

  if (token) {
    const [existing] = await db.select({ id: tickets.id, statusId: tickets.statusId })
      .from(tickets).where(eq(tickets.number, token));
    if (existing) {
      await db.insert(ticketComments).values({
        ticketId: existing.id, authorId: sender.id, visibility: 'public',
        bodyText: input.body, source: 'email',
      });
      await db.insert(ticketEvents).values({
        ticketId: existing.id, actorId: sender.id, actorType: 'user',
        eventType: 'email_reply', newValue: input.subject,
      });
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, existing.id));

      // Requester replied to a resolved ticket → reopen (SLA clock resumes).
      const [status] = await db.select().from(statuses).where(eq(statuses.id, existing.statusId));
      if (status && (status.category === 'resolved' || status.category === 'closed')) {
        const [openStatus] = await db.select().from(statuses)
          .where(eq(statuses.category, 'open')).orderBy(statuses.position).limit(1);
        if (openStatus) {
          await applyTicketChanges(existing.id, { id: null, type: 'system' }, { statusId: openStatus.id });
        }
      }
      return { action: 'appended' as const, ticketId: existing.id, number: token };
    }
  }

  const created = await createTicketCore({
    subject: input.subject.replace(SUBJECT_TOKEN, '').replace(/^(re|fwd?):\s*/i, '').trim() || '(no subject)',
    description: input.body,
    requesterId: sender.id,
    source: 'email',
  });
  enrichTicket(created.id, 'auto').catch(() => {});
  return { action: 'created' as const, ticketId: created.id, number: created.number };
}

export type MailboxEntry = {
  kind: 'sent' | 'ack' | 'reply';
  from: string;
  at: string;
  body: string;
};

/**
 * The requester's inbox, reconstructed from ticket data: their original
 * email, the system auto-ack, public agent replies (outbound mail), and
 * their own follow-ups.
 */
export async function mailboxFor(email: string) {
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, normalized));
  if (!user) return { email: normalized, threads: [] };

  const ticketRows = await db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, createdAt: tickets.createdAt,
      statusName: statuses.name, categoryName: categories.name,
    })
    .from(tickets)
    .innerJoin(statuses, eq(statuses.id, tickets.statusId))
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(and(eq(tickets.requesterId, user.id), eq(tickets.source, 'email')))
    .orderBy(desc(tickets.createdAt))
    .limit(8);
  if (ticketRows.length === 0) return { email: normalized, threads: [] };

  const ids = ticketRows.map((t) => t.id);
  const author = schema.users;
  const comments = await db
    .select({
      ticketId: ticketComments.ticketId, body: ticketComments.bodyText,
      createdAt: ticketComments.createdAt, authorId: ticketComments.authorId,
      authorName: author.name,
    })
    .from(ticketComments)
    .innerJoin(author, eq(author.id, ticketComments.authorId))
    .where(and(inArray(ticketComments.ticketId, ids), eq(ticketComments.visibility, 'public')))
    .orderBy(asc(ticketComments.createdAt));

  const threads = ticketRows.map((t) => {
    const entries: MailboxEntry[] = [
      { kind: 'sent', from: normalized, at: t.createdAt.toISOString(), body: t.description },
      {
        kind: 'ack', from: HELPDESK, at: t.createdAt.toISOString(),
        body: `Your request has been received and assigned ticket ${t.number}. Reply to this email to add information — keep [${t.number}] in the subject.`,
      },
      ...comments.filter((c) => c.ticketId === t.id).map((c): MailboxEntry => ({
        kind: c.authorId === user.id ? 'sent' : 'reply',
        from: c.authorId === user.id ? normalized : `${c.authorName} via ${HELPDESK}`,
        at: c.createdAt.toISOString(),
        body: c.body,
      })),
    ];
    return {
      number: t.number, subject: `[${t.number}] ${t.subject}`,
      status: t.statusName, category: t.categoryName, entries,
    };
  });

  return { email: normalized, threads };
}
