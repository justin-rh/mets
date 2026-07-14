import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getBotUser } from './templates.js';
import { sharedTokens, tokens } from './incidents.js';

const { tickets, ticketLinks, ticketComments, ticketEvents, statuses, users } = schema;

/**
 * Identifier tokens: part numbers, order numbers, model codes — the strings
 * where "looks similar" means nothing. ERJ-3EKF1002V and ERJ-3EKF1001V are
 * one character apart and completely different parts, so identifiers are
 * compared EXACTLY, never fuzzily. A code must contain a digit and either a
 * letter or be long enough to not be a bare quantity.
 */
export function extractIdentifiers(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.match(/\b[A-Za-z0-9][A-Za-z0-9-]{3,}\b/g) ?? []) {
    const v = raw.toUpperCase().replace(/-+$/, '');
    if (!/\d/.test(v)) continue;               // no digits → ordinary word
    if (/^T-\d{7}$/.test(v)) continue;         // our own ticket numbers
    if (!/[A-Z]/.test(v) && v.length < 6) continue; // short bare numbers = quantities
    out.add(v);
  }
  return out;
}

export type IdentifierCheck = {
  conflict: boolean;
  shared: string[];
  onlyInSource: string[];
  onlyInTarget: string[];
};

/** Conflict = both tickets cite identifiers and none of them match. */
export function compareIdentifiers(sourceText: string, targetText: string): IdentifierCheck {
  const a = extractIdentifiers(sourceText);
  const b = extractIdentifiers(targetText);
  const shared = [...a].filter((x) => b.has(x));
  return {
    conflict: a.size > 0 && b.size > 0 && shared.length === 0,
    shared,
    onlyInSource: [...a].filter((x) => !b.has(x)).slice(0, 5),
    onlyInTarget: [...b].filter((x) => !a.has(x)).slice(0, 5),
  };
}

/** Open tickets that look like duplicates of this one, best match first. */
export async function mergeCandidates(ticketId: number) {
  const [t] = await db.select({
    id: tickets.id, subject: tickets.subject, description: tickets.description,
  }).from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return [];
  const myTokens = tokens(t.subject);
  const myText = `${t.subject}\n${t.description}`;

  const rows = (await db.execute(sql`
    select t2.id, t2.number, t2.subject, t2.description, u.name as requester
    from tickets t2
    join statuses s on s.id = t2.status_id
    join users u on u.id = t2.requester_id
    where s.category not in ('resolved','closed')
      and t2.id != ${ticketId}
      and not exists (select 1 from ticket_links l
        where (l.ticket_id = t2.id or l.linked_ticket_id = t2.id) and l.type = 'duplicate_of')
  `)).rows as { id: number; number: string; subject: string; description: string; requester: string }[];

  return rows
    .map((r) => {
      const check = compareIdentifiers(myText, `${r.subject}\n${r.description}`);
      return {
        id: Number(r.id), number: r.number, subject: r.subject, requester: r.requester,
        similarity: sharedTokens(myTokens, tokens(r.subject)) + check.shared.length * 2,
        check,
      };
    })
    .filter((r) => r.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

/**
 * Merge `dupId` into `targetId`: the duplicate closes with a duplicate_of
 * link, its requester is told where the work continues (and receives future
 * public replies on the target via the broadcast fan-out), and the target
 * gets an internal note carrying the duplicate's context. When the two
 * tickets cite non-matching part/order numbers the merge stops with the
 * mismatch until the agent explicitly forces it.
 */
export async function mergeTickets(dupId: number, targetId: number, actorId: number, force = false) {
  if (dupId === targetId) throw Object.assign(new Error('cannot merge a ticket into itself'), { statusCode: 400 });
  const load = (id: number) => db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, requesterId: tickets.requesterId,
      statusCategory: statuses.category,
    })
    .from(tickets).innerJoin(statuses, eq(statuses.id, tickets.statusId))
    .where(eq(tickets.id, id)).then((r) => r[0]);
  const [dup, target] = await Promise.all([load(dupId), load(targetId)]);
  if (!dup || !target) throw Object.assign(new Error('ticket not found'), { statusCode: 404 });
  if (target.statusCategory === 'resolved' || target.statusCategory === 'closed') {
    throw Object.assign(new Error('target ticket is already closed — merge into an open one'), { statusCode: 400 });
  }
  const [dupAlready] = await db.select().from(ticketLinks).where(and(
    eq(ticketLinks.ticketId, dupId), eq(ticketLinks.type, 'duplicate_of')));
  if (dupAlready) throw Object.assign(new Error('ticket is already merged'), { statusCode: 409 });
  const [targetMerged] = await db.select({ into: tickets.number }).from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.linkedTicketId))
    .where(and(eq(ticketLinks.ticketId, targetId), eq(ticketLinks.type, 'duplicate_of')));
  if (targetMerged) {
    throw Object.assign(new Error(`target was itself merged into ${targetMerged.into} — merge into that one`), { statusCode: 400 });
  }

  // The part-number guard.
  const check = compareIdentifiers(
    `${dup.subject}\n${dup.description}`, `${target.subject}\n${target.description}`);
  if (check.conflict && !force) {
    return { merged: false as const, requiresConfirmation: true as const, check };
  }

  await db.insert(ticketLinks).values({ ticketId: dupId, linkedTicketId: targetId, type: 'duplicate_of' })
    .onConflictDoNothing();

  const [closed] = await db.select().from(statuses)
    .where(eq(statuses.category, 'closed')).orderBy(asc(statuses.position)).limit(1);
  const { applyTicketChanges } = await import('./ticketService.js');
  if (closed) await applyTicketChanges(dupId, { id: actorId }, { statusId: closed.id });

  await db.insert(ticketEvents).values([
    {
      ticketId: dupId, actorId, actorType: 'user', eventType: 'merged_into',
      field: 'duplicate', newValue: target.number,
      oldValue: check.shared.length ? `shared: ${check.shared.slice(0, 3).join(', ')}` : undefined,
    },
    {
      ticketId: targetId, actorId, actorType: 'user', eventType: 'absorbed_duplicate',
      field: 'duplicate', newValue: dup.number,
    },
  ]);

  const bot = await getBotUser();
  const [dupRequester] = await db.select({ name: users.name }).from(users)
    .where(eq(users.id, dup.requesterId));
  await db.insert(ticketComments).values([
    {
      ticketId: dupId, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Hi ${dupRequester?.name.split(' ')[0] ?? 'there'},\n\nThis was reported by someone else too, so we've merged your ticket into ${target.number} to work it in one place. Updates on that ticket will be posted here automatically — nothing else you need to do.\n\n— SOTO Bot`,
    },
    {
      ticketId: targetId, authorId: actorId, visibility: 'internal', source: 'agent',
      bodyText: `⇄ Merged duplicate ${dup.number} (${dupRequester?.name ?? 'unknown'}): "${dup.subject}" — ${dup.description.slice(0, 300)}`,
    },
  ]);

  return { merged: true as const, target: target.number, check };
}
