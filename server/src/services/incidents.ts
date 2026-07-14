import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider } from './ai/provider.js';
import { getBotUser } from './templates.js';

const { tickets, ticketLinks, ticketComments, ticketEvents, statuses, users, aiUsage } = schema;

// A burst of MIN_CLUSTER similar tickets in the same category within
// WINDOW_MINUTES triggers an AI assessment; a confirmed incident gets a P1
// parent ticket and the burst is linked under it.
const WINDOW_MINUTES = 120;
const MIN_CLUSTER = 3;
const MIN_CONFIDENCE = 0.6;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'not', 'cannot', 'cant',
  'wont', 'our', 'has', 'have', 'was', 'are', 'is', 'my', 'any', 'all', 'when',
  'after', 'before', 'again', 'still', 'since', 'been', 'get', 'gets', 'getting',
  'need', 'needs', 'help', 'please', 'issue', 'problem', 'error', 'working',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function sharedTokens(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared;
}

type Candidate = { id: number; number: string; subject: string; description: string };

/** Children of a parent incident (child_of links point child -> parent). */
export async function incidentChildren(parentId: number) {
  return db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      requesterId: tickets.requesterId, firstRespondedAt: tickets.firstRespondedAt,
      statusName: statuses.name,
    })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.ticketId))
    .innerJoin(statuses, eq(statuses.id, tickets.statusId))
    .where(and(eq(ticketLinks.linkedTicketId, parentId), eq(ticketLinks.type, 'child_of')));
}

async function linkChild(childId: number, parent: { id: number; number: string; title: string }) {
  await db.insert(ticketLinks)
    .values({ ticketId: childId, linkedTicketId: parent.id, type: 'child_of' })
    .onConflictDoNothing();
  await db.insert(ticketEvents).values({
    ticketId: childId, actorId: null, actorType: 'ai', eventType: 'linked_to_incident',
    field: 'incident', newValue: parent.number, oldValue: parent.title,
  });
  const bot = await getBotUser();
  const [child] = await db
    .select({ name: users.name }).from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, childId));
  await db.insert(ticketComments).values({
    ticketId: childId, authorId: bot.id, visibility: 'public', source: 'api',
    bodyText: `Hi ${child?.name.split(' ')[0] ?? 'there'},\n\nYou're not alone — several similar reports came in around the same time, and we're treating them as one incident (${parent.number}: ${parent.title}). Updates from the response team will be posted here automatically; no need to file anything else.\n\n— SOTO Bot`,
  });
}

/**
 * Run after AI triage lands a category. Looks for a burst of textually
 * similar open tickets in the same category; a confirmed burst becomes a P1
 * "Major incident" parent with the burst linked as children (existing open
 * incidents absorb matching newcomers instead of spawning duplicates).
 */
export async function detectMajorIncident(ticketId: number) {
  const [t] = await db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, categoryId: tickets.categoryId,
      queueId: tickets.queueId,
    })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t?.categoryId) return null;

  const [alreadyLinked] = await db.select({ id: ticketLinks.ticketId }).from(ticketLinks)
    .where(eq(ticketLinks.ticketId, ticketId));
  if (alreadyLinked) return null;

  const myTokens = tokens(t.subject);

  // 1) An open incident in this category already? Absorb the newcomer.
  const openParents = (await db.execute(sql`
    select p.id, p.number, p.subject from tickets p
    join statuses s on s.id = p.status_id
    where s.category not in ('resolved','closed')
      and p.category_id = ${t.categoryId}
      and p.created_at > now() - interval '24 hours'
      and exists (select 1 from ticket_links l where l.linked_ticket_id = p.id and l.type = 'child_of')
  `)).rows as { id: number; number: string; subject: string }[];
  for (const p of openParents) {
    const title = p.subject.replace(/^Major incident:\s*/i, '');
    if (sharedTokens(myTokens, tokens(title)) >= 1) {
      await linkChild(ticketId, { id: Number(p.id), number: p.number, title });
      return { attached: p.number };
    }
  }

  // 2) Otherwise: is there a fresh burst?
  const candidates = (await db.execute(sql`
    select t2.id, t2.number, t2.subject, t2.description from tickets t2
    join statuses s on s.id = t2.status_id
    where s.category not in ('resolved','closed')
      and t2.category_id = ${t.categoryId}
      and t2.id != ${ticketId}
      and t2.created_at > now() - make_interval(mins => ${WINDOW_MINUTES})
      and not exists (select 1 from ticket_links l where l.ticket_id = t2.id or l.linked_ticket_id = t2.id)
  `)).rows as Candidate[];

  // Burst signal: some significant token from this subject (the product or
  // service name — "zoom", "merp", "vpn") appearing across enough recent
  // subjects. Recall-oriented on purpose; the AI assessment below is the
  // precision gate that rejects coincidental lookalikes.
  const byToken = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const ct = tokens(c.subject);
    for (const w of myTokens) {
      if (ct.has(w)) (byToken.get(w) ?? byToken.set(w, []).get(w)!).push(c);
    }
  }
  let cluster: Candidate[] = [];
  for (const list of byToken.values()) if (list.length > cluster.length) cluster = list;
  if (cluster.length + 1 < MIN_CLUSTER) return null;

  const burst = [t, ...cluster].map((c) => ({
    number: c.number, subject: c.subject, description: c.description,
  }));
  const outcome = await getAIProvider().assessIncident({ tickets: burst });
  await db.insert(aiUsage).values({
    feature: 'incident', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });
  if (!outcome.result.isIncident || outcome.result.confidence < MIN_CONFIDENCE) return null;

  // 3) Declare — advisory lock per category so a concurrent burst can't
  // declare two parents.
  const parent = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'incident-' + t.categoryId}))`);
    const [existing] = (await tx.execute(sql`
      select p.id from tickets p
      join statuses s on s.id = p.status_id
      where s.category not in ('resolved','closed') and p.category_id = ${t.categoryId}
        and p.created_at > now() - interval '24 hours'
        and exists (select 1 from ticket_links l where l.linked_ticket_id = p.id and l.type = 'child_of')
    `)).rows as { id: number }[];
    if (existing) return null; // someone beat us to it; newcomers absorb next pass

    const bot = await getBotUser();
    const [defaultStatus] = await tx.select().from(statuses)
      .where(eq(statuses.isDefault, true)).limit(1);
    const [created] = await tx.insert(tickets).values({
      subject: `Major incident: ${outcome.result.title}`,
      description: `${outcome.result.summary}\n\nDeclared automatically from ${burst.length} similar reports: ${burst.map((b) => b.number).join(', ')}. Public replies on this ticket broadcast to every linked requester.`,
      type: 'incident', priority: 1,
      statusId: defaultStatus!.id, queueId: t.queueId, categoryId: t.categoryId,
      requesterId: bot.id, source: 'api',
    }).returning();
    await tx.insert(ticketEvents).values({
      ticketId: created!.id, actorId: null, actorType: 'ai', eventType: 'incident_declared',
      field: 'incident', newValue: `${burst.length} linked reports`,
      oldValue: `confidence ${outcome.result.confidence}`,
    });
    return created!;
  });
  if (!parent) return null;

  const { attachSlas } = await import('./sla/slaService.js');
  await attachSlas(db, parent.id, 1);
  const { recomputeScore } = await import('./scoring.js');
  await recomputeScore(db, parent.id);

  const title = outcome.result.title;
  for (const b of [t, ...cluster]) {
    await linkChild(Number(b.id), { id: parent.id, number: parent.number, title });
  }
  return { declared: parent.number, children: burst.length };
}

/**
 * A public agent reply on an incident parent fans out to every child as a
 * SOTO Bot comment, and counts as the children's first response.
 */
export async function broadcastIncidentUpdate(parentId: number, body: string, authorName: string) {
  const children = await incidentChildren(parentId);
  if (children.length === 0) return 0;
  const [parent] = await db.select({ number: tickets.number }).from(tickets)
    .where(eq(tickets.id, parentId));
  const bot = await getBotUser();
  const { completeFirstResponse } = await import('./sla/slaService.js');

  for (const child of children) {
    await db.insert(ticketComments).values({
      ticketId: child.id, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Incident update from ${authorName} (${parent?.number}):\n\n${body}\n\n— SOTO Bot`,
    });
    await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, child.id));
    if (!child.firstRespondedAt) {
      await db.update(tickets).set({ firstRespondedAt: new Date() }).where(eq(tickets.id, child.id));
      await completeFirstResponse(child.id);
    }
  }
  return children.length;
}

/** Parent/children view for the ticket detail. */
export async function incidentInfo(ticketId: number) {
  const [parentRow] = await db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.linkedTicketId))
    .where(and(eq(ticketLinks.ticketId, ticketId), eq(ticketLinks.type, 'child_of')))
    .orderBy(asc(ticketLinks.linkedTicketId))
    .limit(1);
  const children = await incidentChildren(ticketId);
  return {
    parent: parentRow ?? null,
    children: children.map((c) => ({ id: c.id, number: c.number, subject: c.subject, status: c.statusName })),
  };
}
