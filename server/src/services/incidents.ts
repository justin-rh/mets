import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider } from './ai/provider.js';
import { getBotUser } from './templates.js';

const { tickets, ticketLinks, ticketComments, ticketEvents, statuses, users, aiUsage } = schema;

// A burst of MIN_CLUSTER similar tickets in the same category within
// WINDOW_MINUTES triggers an AI assessment; a confirmed burst gets a P1
// "Suspected incident" parent ticket and the burst is linked under it.
const WINDOW_MINUTES = 20;
const MIN_CLUSTER = 3;
const MIN_CONFIDENCE = 0.6;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'not', 'cannot', 'cant',
  'wont', 'our', 'has', 'have', 'was', 'are', 'is', 'my', 'any', 'all', 'when',
  'after', 'before', 'again', 'still', 'since', 'been', 'get', 'gets', 'getting',
  'need', 'needs', 'help', 'please', 'issue', 'problem', 'error', 'working',
]);

export function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

export function sharedTokens(a: Set<string>, b: Set<string>): number {
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
 * "Suspected incident" parent with the burst linked as children (existing open
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
    const title = p.subject.replace(/^(?:major|suspected) incident:\s*/i, '');
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
  // One retry on transient API failure — a missed assessment here means the
  // outage stays undeclared until another report happens to arrive.
  let outcome;
  try {
    outcome = await getAIProvider().assessIncident({ tickets: burst });
  } catch (e) {
    console.error('[incidents] assessment failed, retrying in 20s:', e);
    await new Promise((r) => setTimeout(r, 20_000));
    outcome = await getAIProvider().assessIncident({ tickets: burst });
  }
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
      subject: `Suspected incident: ${outcome.result.title}`,
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

  // Handling instructions for whoever picks this up — internal so it never
  // broadcasts to the linked requesters.
  const bot = await getBotUser();
  await db.insert(ticketComments).values({
    ticketId: parent.id, authorId: bot.id, visibility: 'internal', source: 'api',
    bodyText: 'Comments on this parent ticket automatically propagate to children tickets. Close or resolve this ticket to close/resolve the incident and all children tickets as well.\n\n*— SOTO Bot*',
  });

  return { declared: parent.number, children: burst.length };
}

/**
 * A public agent reply on an incident parent (or a ticket that absorbed
 * duplicates) fans out to every linked ticket as a SOTO Bot comment, and
 * counts as incident children's first response.
 */
export async function broadcastIncidentUpdate(parentId: number, body: string, authorName: string) {
  const linked = await db
    .select({
      id: tickets.id, linkType: ticketLinks.type,
      firstRespondedAt: tickets.firstRespondedAt,
    })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.ticketId))
    .where(and(
      eq(ticketLinks.linkedTicketId, parentId),
      sql`${ticketLinks.type} in ('child_of', 'duplicate_of')`,
    ));
  if (linked.length === 0) return 0;
  const [parent] = await db.select({ number: tickets.number }).from(tickets)
    .where(eq(tickets.id, parentId));
  const bot = await getBotUser();
  const { completeFirstResponse } = await import('./sla/slaService.js');

  for (const child of linked) {
    const intro = child.linkType === 'duplicate_of'
      ? `Update from ${authorName} on ${parent?.number} (your ticket was merged into it):`
      : `Incident update from ${authorName} (${parent?.number}):`;
    await db.insert(ticketComments).values({
      ticketId: child.id, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `${intro}\n\n${body}\n\n— SOTO Bot`,
    });
    await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, child.id));
    if (child.linkType === 'child_of' && !child.firstRespondedAt) {
      await db.update(tickets).set({ firstRespondedAt: new Date() }).where(eq(tickets.id, child.id));
      await completeFirstResponse(child.id);
    }
  }
  return linked.length;
}

/**
 * Open incident parents, for the app-wide banner. Any ticket with child_of
 * links pointing at it is an incident parent; safe for requesters (no
 * requester names, just the outage itself).
 */
export async function activeIncidents() {
  const rows = (await db.execute(sql`
    select p.id, p.number, p.subject, p.created_at as "createdAt",
           s.name as status, tm.name as queue,
           count(l.ticket_id)::int as "childCount"
    from tickets p
    join statuses s on s.id = p.status_id
    join teams tm on tm.id = p.queue_id
    join ticket_links l on l.linked_ticket_id = p.id and l.type = 'child_of'
    where s.category not in ('resolved', 'closed')
    group by p.id, p.number, p.subject, p.created_at, s.name, tm.name
    order by p.created_at desc
  `)).rows as { id: number; number: string; subject: string; createdAt: string; status: string; queue: string; childCount: number }[];
  // Raw execute() returns ids as strings and pg-format timestamps —
  // normalize so the client's strict-equality and Date parsing hold.
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    childCount: Number(r.childCount),
    createdAt: new Date(r.createdAt).toISOString(),
    title: r.subject.replace(/^(?:major|suspected) incident:\s*/i, ''),
  }));
}

/**
 * Resolving an incident parent cascades: every still-open child gets a
 * closing SOTO comment and is resolved with it. A requester who's still
 * broken just replies — the existing reply-reopens path brings the child
 * back. Returns how many children were closed.
 */
export async function resolveIncidentCascade(parentId: number, actorId: number | null) {
  const open = (await db.execute(sql`
    select t.id, t.number from tickets t
    join ticket_links l on l.ticket_id = t.id and l.type = 'child_of' and l.linked_ticket_id = ${parentId}
    join statuses s on s.id = t.status_id
    where s.category not in ('resolved', 'closed')
  `)).rows as { id: number; number: string }[];
  if (open.length === 0) return 0;

  const [parent] = await db.select({ number: tickets.number, subject: tickets.subject })
    .from(tickets).where(eq(tickets.id, parentId));
  const title = parent?.subject.replace(/^(?:major|suspected) incident:\s*/i, '') ?? '';
  const [resolved] = await db.select().from(statuses)
    .where(eq(statuses.category, 'resolved')).orderBy(asc(statuses.position)).limit(1);
  if (!resolved) return 0;
  const bot = await getBotUser();
  const { applyTicketChanges } = await import('./ticketService.js');

  for (const child of open) {
    await db.insert(ticketComments).values({
      ticketId: child.id, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Good news — the incident affecting you (${parent?.number}: ${title}) has been resolved, so this ticket is being closed along with it.\n\nStill seeing the problem? Just reply here and your ticket reopens automatically.\n\n— SOTO Bot`,
    });
    await applyTicketChanges(Number(child.id), { id: null, type: 'system' }, { statusId: resolved.id });
  }
  await db.insert(ticketEvents).values({
    ticketId: parentId, actorId, actorType: actorId ? 'user' : 'system',
    eventType: 'incident_resolved', field: 'incident',
    newValue: `${open.length} linked tickets resolved & notified`,
  });
  return open.length;
}

/** Parent/children/duplicate view for the ticket detail. */
export async function incidentInfo(ticketId: number) {
  const linkedParent = (type: 'child_of' | 'duplicate_of') => db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.linkedTicketId))
    .where(and(eq(ticketLinks.ticketId, ticketId), eq(ticketLinks.type, type)))
    .orderBy(asc(ticketLinks.linkedTicketId))
    .limit(1)
    .then((r) => r[0] ?? null);
  const [parentRow, mergedInto] = await Promise.all([
    linkedParent('child_of'), linkedParent('duplicate_of'),
  ]);
  const children = await incidentChildren(ticketId);
  const duplicates = await db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.ticketId))
    .where(and(eq(ticketLinks.linkedTicketId, ticketId), eq(ticketLinks.type, 'duplicate_of')));
  return {
    parent: parentRow,
    mergedInto,
    children: children.map((c) => ({ id: c.id, number: c.number, subject: c.subject, status: c.statusName })),
    duplicates,
  };
}
