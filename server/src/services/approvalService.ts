import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getBotUser } from './templates.js';

const { approvals, tickets, ticketComments, ticketEvents, users, teams, teamMemberships, statuses, categories } = schema;

/**
 * Approval gate: request-type tickets landing in a requires-approval category
 * (equipment, licenses, …) park at the intake queue in Awaiting Approval
 * (pending — SLA pauses) until the requester's manager signs off. Fired from
 * the category-change hook in applyTicketChanges — or with `force` when an
 * agent flags a ticket as needing sign-off regardless of the gate.
 */
export async function maybeRequestApproval(ticketId: number, opts: { force?: boolean } = {}) {
  const [t] = await db
    .select({
      type: tickets.type, queueId: tickets.queueId, requesterId: tickets.requesterId,
      number: tickets.number, statusId: tickets.statusId,
      requiresApproval: categories.requiresApproval, categoryName: categories.name,
    })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(eq(tickets.id, ticketId));
  if (!t) return null;
  if (!opts.force && (t.type !== 'request' || !t.requiresApproval)) return null;

  const [existing] = await db.select({ id: approvals.id }).from(approvals)
    .where(eq(approvals.ticketId, ticketId));
  if (existing) return null; // one approval cycle per ticket

  // Approver chain: requester's manager → lead of the target queue → an admin.
  const [requester] = await db.select({ name: users.name, managerId: users.managerId })
    .from(users).where(eq(users.id, t.requesterId));
  let approverId = requester?.managerId ?? null;
  if (!approverId) {
    const [lead] = await db.select({ userId: teamMemberships.userId }).from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, t.queueId), eq(teamMemberships.role, 'lead')));
    approverId = lead?.userId ?? null;
  }
  if (!approverId) {
    const [admin] = await db.select({ id: users.id }).from(users)
      .where(eq(users.role, 'admin')).orderBy(asc(users.id)).limit(1);
    approverId = admin?.id ?? null;
  }
  if (!approverId) return null;
  const [approver] = await db.select({ name: users.name }).from(users).where(eq(users.id, approverId));

  const [awaiting] = await db.select().from(statuses).where(eq(statuses.name, 'Awaiting Approval'));
  const [intake] = await db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.id)).limit(1);
  const targetQueueId = t.queueId === intake?.id ? null : t.queueId;

  const [approval] = await db.insert(approvals).values({
    ticketId, approverId, targetQueueId,
  }).returning();

  // Park at intake in Awaiting Approval — deferred import avoids the
  // ticketService <-> approvalService cycle. No categoryId in these changes,
  // so the category hook doesn't re-enter.
  const { applyTicketChanges } = await import('./ticketService.js');
  const changes: Record<string, unknown> = {};
  if (awaiting) changes.statusId = awaiting.id;
  if (targetQueueId && intake) changes.queueId = intake.id;
  if (Object.keys(changes).length > 0) {
    await applyTicketChanges(ticketId, { id: null, type: 'system' }, changes as any);
  }

  await db.insert(ticketEvents).values({
    ticketId, actorId: approverId, actorType: 'system', eventType: 'approval_requested',
    field: 'approver', newValue: approver?.name ?? String(approverId),
    oldValue: t.categoryName,
  });

  const bot = await getBotUser();
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'public', source: 'api',
    bodyText: `Hi ${requester?.name.split(' ')[0] ?? 'there'},\n\n${t.categoryName ? `${t.categoryName} requests need` : 'This request needs'} a sign-off before it's worked. ${t.number} has been sent to ${approver?.name ?? 'your manager'} for approval — you'll get an update here as soon as they decide.\n\n— SOTO Bot`,
  });

  return approval!;
}

/** Approve or reject; approved tickets move on to the queue triage picked. */
export async function decideApproval(
  approvalId: number, actorId: number, approve: boolean, note?: string,
) {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!a) throw Object.assign(new Error('approval not found'), { statusCode: 404 });
  if (a.state !== 'pending') throw Object.assign(new Error('already decided'), { statusCode: 409 });

  const [actor] = await db.select({ role: users.role, name: users.name }).from(users).where(eq(users.id, actorId));
  if (actorId !== a.approverId && actor?.role !== 'admin') {
    throw Object.assign(new Error('only the approver or an admin can decide'), { statusCode: 403 });
  }

  const [updated] = await db.update(approvals).set({
    state: approve ? 'approved' : 'rejected', note: note ?? null,
    decidedAt: new Date(), decidedById: actorId,
  }).where(eq(approvals.id, approvalId)).returning();

  await db.insert(ticketEvents).values({
    ticketId: a.ticketId, actorId, actorType: 'user',
    eventType: approve ? 'approval_granted' : 'approval_rejected',
    field: 'approval', newValue: note ?? undefined,
  });

  const [t] = await db
    .select({ number: tickets.number, requesterName: users.name })
    .from(tickets).innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, a.ticketId));
  const firstName = t?.requesterName.split(' ')[0] ?? 'there';
  const bot = await getBotUser();
  const { applyTicketChanges } = await import('./ticketService.js');

  if (approve) {
    const [openStatus] = await db.select().from(statuses)
      .where(eq(statuses.category, 'new')).orderBy(asc(statuses.position)).limit(1);
    const changes: Record<string, unknown> = {};
    if (openStatus) changes.statusId = openStatus.id;
    if (a.targetQueueId) changes.queueId = a.targetQueueId;
    if (Object.keys(changes).length > 0) {
      await applyTicketChanges(a.ticketId, { id: actorId }, changes as any);
    }
    const [q] = a.targetQueueId
      ? await db.select({ name: teams.name }).from(teams).where(eq(teams.id, a.targetQueueId))
      : [undefined];
    await db.insert(ticketComments).values({
      ticketId: a.ticketId, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Hi ${firstName},\n\nGood news — ${t?.number} was approved by ${actor?.name}${q ? ` and is now with the ${q.name} team` : ''}. An agent will pick it up from here.\n\n— SOTO Bot`,
    });
  } else {
    const [resolved] = await db.select().from(statuses)
      .where(eq(statuses.category, 'resolved')).orderBy(asc(statuses.position)).limit(1);
    if (resolved) await applyTicketChanges(a.ticketId, { id: actorId }, { statusId: resolved.id });
    await db.insert(ticketComments).values({
      ticketId: a.ticketId, authorId: bot.id, visibility: 'public', source: 'api',
      bodyText: `Hi ${firstName},\n\n${t?.number} wasn't approved by ${actor?.name}${note ? `: "${note}"` : ''}. If you think this is a mistake, reply here or talk to your manager and we'll reopen it.\n\n— SOTO Bot`,
    });
  }
  return updated!;
}
