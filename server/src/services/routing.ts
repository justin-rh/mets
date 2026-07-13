import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { applyTicketChanges, type TicketChanges } from './ticketService.js';

const { routingRules, tickets, users, teams, tags, ticketTags, ticketEvents } = schema;

type Cond = { field: string; op: 'contains' | 'eq'; value: unknown };
type Conditions = { any?: Cond[]; all?: Cond[] };
type Actions = { setQueue?: string; minPriority?: number; addTags?: string[] };

type TicketFacts = {
  subject: string; description: string; source: string; priority: number;
  'requester.isVip': boolean; 'requester.department': string | null;
};

function evalCond(c: Cond, facts: TicketFacts): boolean {
  const actual = (facts as any)[c.field];
  if (actual === undefined) return false;
  if (c.op === 'contains') {
    return typeof actual === 'string' && actual.toLowerCase().includes(String(c.value).toLowerCase());
  }
  return actual === c.value;
}

function matches(conditions: Conditions, facts: TicketFacts): boolean {
  if (conditions.all?.length) return conditions.all.every((c) => evalCond(c, facts));
  if (conditions.any?.length) return conditions.any.some((c) => evalCond(c, facts));
  return false;
}

/**
 * Evaluate routing rules for a new ticket: ordered, first-match-wins with
 * explicit stop. The firing is logged as a rule-actor event — routing
 * debuggability is the #1 admin complaint in every tool we researched.
 */
export async function applyRoutingRules(ticketId: number) {
  const [t] = await db
    .select({
      subject: tickets.subject, description: tickets.description,
      source: tickets.source, priority: tickets.priority, queueId: tickets.queueId,
      isVip: users.isVip, department: users.department,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, ticketId));
  if (!t) return null;

  const facts: TicketFacts = {
    subject: t.subject, description: t.description, source: t.source,
    priority: t.priority, 'requester.isVip': t.isVip, 'requester.department': t.department,
  };

  const rules = await db.select().from(routingRules)
    .where(eq(routingRules.enabled, true))
    .orderBy(asc(routingRules.position));
  const rule = rules.find((r) => matches(r.conditions as Conditions, facts));
  if (!rule) return null;

  await db.insert(ticketEvents).values({
    ticketId, actorType: 'rule', eventType: 'rule_matched', newValue: rule.name,
  });

  const actions = rule.actions as Actions;
  const changes: TicketChanges = {};
  if (actions.setQueue) {
    const [q] = await db.select().from(teams).where(eq(teams.slug, actions.setQueue));
    if (q && q.id !== t.queueId) changes.queueId = q.id;
  }
  if (actions.minPriority && t.priority > actions.minPriority) {
    changes.priority = actions.minPriority;
  }
  if (Object.keys(changes).length > 0) {
    await applyTicketChanges(ticketId, { id: null, type: 'rule' }, changes);
  }

  for (const name of actions.addTags ?? []) {
    let [tag] = await db.select().from(tags).where(eq(tags.name, name));
    if (!tag) [tag] = await db.insert(tags).values({ name }).returning();
    await db.insert(ticketTags).values({ ticketId, tagId: tag!.id }).onConflictDoNothing();
  }

  return rule.name;
}
