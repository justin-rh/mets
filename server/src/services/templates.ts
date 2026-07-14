import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { responseTemplates, tickets, ticketComments, ticketEvents, users, teams, categories } = schema;

// SOTO: Sorts Out Tickets, Obviously. (METS · SOTO — he bats for us now.)
export const BOT_NAME = 'SOTO Bot';
const BOT_EMAIL = 'soto-bot@masterelectronics.com';

/** Auto-responses need an author; comments are never authorless. */
export async function getBotUser() {
  const [existing] = await db.select().from(users).where(eq(users.email, BOT_EMAIL));
  if (existing) return existing;
  const [bot] = await db.insert(users).values({
    name: BOT_NAME, email: BOT_EMAIL, role: 'readonly', department: 'IT', location: 'Remote',
  }).returning();
  return bot!;
}

export type TemplateContext = {
  ticket: { number: string; subject: string };
  requester: { name: string; firstName: string };
  agent: { name: string; firstName: string };
  queue: { name: string };
  category: { name: string };
};

/**
 * {{path}} substitution against the context above, e.g. {{requester.firstName}}
 * or {{ticket.number}}. Unknown variables are left in place so typos are
 * visible in the admin preview rather than silently blanked.
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  return body.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (raw, path: string) => {
    const value = path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), ctx);
    return typeof value === 'string' ? value : raw;
  });
}

export async function buildTemplateContext(ticketId: number, agentId?: number): Promise<TemplateContext | null> {
  const [t] = await db
    .select({
      number: tickets.number, subject: tickets.subject,
      requesterName: users.name, queueName: teams.name, categoryName: categories.name,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .innerJoin(teams, eq(teams.id, tickets.queueId))
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(eq(tickets.id, ticketId));
  if (!t) return null;

  let agentName = 'the METS team';
  if (agentId) {
    const [a] = await db.select({ name: users.name }).from(users).where(eq(users.id, agentId));
    if (a) agentName = a.name;
  }
  const first = (name: string) => name.split(' ')[0]!;
  return {
    ticket: { number: t.number, subject: t.subject },
    requester: { name: t.requesterName, firstName: first(t.requesterName) },
    agent: { name: agentName, firstName: first(agentName) },
    queue: { name: t.queueName },
    category: { name: t.categoryName ?? 'General' },
  };
}

/** Active templates rendered for a ticket; matching-category first, then A→Z. */
export async function templatesForTicket(ticketId: number, agentId: number) {
  const ctx = await buildTemplateContext(ticketId, agentId);
  if (!ctx) return [];
  const [t] = await db.select({ categoryId: tickets.categoryId }).from(tickets).where(eq(tickets.id, ticketId));
  const rows = await db.select().from(responseTemplates).where(eq(responseTemplates.isActive, true));
  return rows
    .sort((a, b) =>
      Number(b.categoryId === t?.categoryId && b.categoryId != null)
        - Number(a.categoryId === t?.categoryId && a.categoryId != null)
      || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id, name: r.name, categoryId: r.categoryId, autoRespond: r.autoRespond,
      body: renderTemplate(r.body, ctx),
    }));
}

/**
 * Fire auto-respond templates as public SOTO Bot comments. 'created' posts the
 * global acknowledgment (categoryId null); 'categorized' posts the template
 * matching the ticket's category and completes the first-response SLA (a
 * substantive answer, unlike the ack). Each template fires at most once per
 * ticket, tracked via auto_responded events.
 */
export async function runAutoResponses(ticketId: number, trigger: 'created' | 'categorized') {
  const [t] = await db.select({ categoryId: tickets.categoryId }).from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return [];

  const matches = await db.select().from(responseTemplates).where(and(
    eq(responseTemplates.isActive, true),
    eq(responseTemplates.autoRespond, true),
    trigger === 'created'
      ? isNull(responseTemplates.categoryId)
      : eq(responseTemplates.categoryId, t.categoryId ?? -1),
  ));
  if (matches.length === 0) return [];

  const fired = await db.select({ newValue: ticketEvents.newValue }).from(ticketEvents).where(and(
    eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.eventType, 'auto_responded'),
  ));
  const already = new Set(fired.map((f) => f.newValue));
  const pending = matches.filter((m) => !already.has(String(m.id)));
  if (pending.length === 0) return [];

  const bot = await getBotUser();
  const ctx = await buildTemplateContext(ticketId);
  if (!ctx) return [];

  const posted = [];
  for (const template of pending) {
    await db.insert(ticketComments).values({
      ticketId, authorId: bot.id, visibility: 'public',
      bodyText: renderTemplate(template.body, ctx), source: 'api',
    });
    await db.insert(ticketEvents).values({
      ticketId, actorId: bot.id, actorType: 'system', eventType: 'auto_responded',
      field: 'template', newValue: String(template.id), oldValue: template.name,
    });
    posted.push(template.name);
  }

  // A category-matched auto-reply is a real first response; the ack is not.
  if (trigger === 'categorized') {
    const [before] = await db.select({ firstRespondedAt: tickets.firstRespondedAt })
      .from(tickets).where(eq(tickets.id, ticketId));
    if (!before?.firstRespondedAt) {
      await db.update(tickets).set({ firstRespondedAt: new Date(), updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
      const { completeFirstResponse } = await import('./sla/slaService.js');
      await completeFirstResponse(ticketId);
    }
  }
  return posted;
}
