import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { recomputeScore } from './scoring.js';
import { onPriorityChange, onStatusCategoryChange } from './sla/slaService.js';

const { tickets, ticketEvents, statuses, users, teams, teamMemberships, categories, skills, agentSkills } = schema;

export type TicketChanges = {
  assigneeId?: number | null;
  queueId?: number;
  statusId?: number;
  priority?: number;
  categoryId?: number;
  snooze?: { until: string; reason: string } | null; // null = unsnooze
  manualBoost?: number;
};

type Actor = { id: number | null; type?: 'user' | 'system' | 'rule' | 'ai' };

/**
 * Apply changes to one ticket, writing audit events in the same transaction
 * (design rule: events come from the service layer, never triggers).
 */
export async function applyTicketChanges(ticketId: number, actor: Actor, changes: TicketChanges) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!current) throw Object.assign(new Error('ticket not found'), { statusCode: 404 });

    const events: (typeof ticketEvents.$inferInsert)[] = [];
    const updates: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
    const ev = (eventType: string, field?: string, oldValue?: string | null, newValue?: string | null) =>
      events.push({ ticketId, actorId: actor.id, actorType: actor.type ?? 'user', eventType, field, oldValue: oldValue ?? undefined, newValue: newValue ?? undefined });

    const nameOf = async (userId: number | null) => {
      if (userId == null) return null;
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
      return u?.name ?? String(userId);
    };

    if (changes.assigneeId !== undefined && changes.assigneeId !== current.assigneeId) {
      updates.assigneeId = changes.assigneeId;
      ev('assigned', 'assignee', await nameOf(current.assigneeId), await nameOf(changes.assigneeId));
      // Assigning a New ticket moves it to the default open-category status.
      if (changes.assigneeId != null && changes.statusId === undefined) {
        const [curStatus] = await tx.select().from(statuses).where(eq(statuses.id, current.statusId));
        if (curStatus?.category === 'new') {
          const [openStatus] = await tx.select().from(statuses)
            .where(eq(statuses.category, 'open')).orderBy(statuses.position).limit(1);
          if (openStatus) {
            updates.statusId = openStatus.id;
            ev('status_changed', 'status', curStatus.name, openStatus.name);
          }
        }
      }
    }

    if (changes.queueId !== undefined && changes.queueId !== current.queueId) {
      const [oldQ] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, current.queueId));
      const [newQ] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, changes.queueId));
      if (!newQ) throw Object.assign(new Error('queue not found'), { statusCode: 400 });
      updates.queueId = changes.queueId;
      ev('moved', 'queue', oldQ?.name, newQ.name);
      // Moving queues drops an assignee who isn't on the new team.
      const targetAssignee = updates.assigneeId !== undefined ? updates.assigneeId : current.assigneeId;
      if (targetAssignee != null) {
        const [member] = await tx.select().from(teamMemberships).where(and(
          eq(teamMemberships.teamId, changes.queueId), eq(teamMemberships.userId, targetAssignee)));
        if (!member) {
          updates.assigneeId = null;
          ev('assigned', 'assignee', await nameOf(targetAssignee), null);
        }
      }
    }

    if (changes.statusId !== undefined && changes.statusId !== current.statusId && updates.statusId === undefined) {
      const [oldS] = await tx.select().from(statuses).where(eq(statuses.id, current.statusId));
      const [newS] = await tx.select().from(statuses).where(eq(statuses.id, changes.statusId));
      if (!newS) throw Object.assign(new Error('status not found'), { statusCode: 400 });
      updates.statusId = changes.statusId;
      ev('status_changed', 'status', oldS?.name, newS.name);
      if ((newS.category === 'resolved' || newS.category === 'closed') && !current.resolvedAt) {
        updates.resolvedAt = new Date();
      }
      if (newS.category === 'closed' && !current.closedAt) updates.closedAt = new Date();
      if (newS.category !== 'resolved' && newS.category !== 'closed' && current.resolvedAt) {
        updates.resolvedAt = null; // reopen
        updates.closedAt = null;
      }
    }

    if (changes.priority !== undefined && changes.priority !== current.priority) {
      updates.priority = changes.priority;
      ev('priority_changed', 'priority', `P${current.priority}`, `P${changes.priority}`);
    }

    if (changes.categoryId !== undefined && changes.categoryId !== current.categoryId) {
      const [oldC] = current.categoryId
        ? await tx.select({ name: categories.name }).from(categories).where(eq(categories.id, current.categoryId))
        : [undefined];
      const [newC] = await tx.select({ name: categories.name }).from(categories).where(eq(categories.id, changes.categoryId));
      if (!newC) throw Object.assign(new Error('category not found'), { statusCode: 400 });
      updates.categoryId = changes.categoryId;
      ev('categorized', 'category', oldC?.name, newC.name);
    }

    if (changes.snooze !== undefined) {
      if (changes.snooze === null) {
        if (current.snoozedUntil) {
          updates.snoozedUntil = null;
          updates.snoozeReason = null;
          ev('unsnoozed', 'snoozed_until', current.snoozedUntil.toISOString(), null);
        }
      } else {
        updates.snoozedUntil = new Date(changes.snooze.until);
        updates.snoozeReason = changes.snooze.reason;
        ev('snoozed', 'snoozed_until', null, `${changes.snooze.until} — ${changes.snooze.reason}`);
      }
    }

    if (changes.manualBoost !== undefined && changes.manualBoost !== current.manualBoost) {
      updates.manualBoost = Math.max(-10, Math.min(10, changes.manualBoost));
      ev('boost_changed', 'manual_boost', String(current.manualBoost), String(updates.manualBoost));
    }

    if (events.length === 0) return { ticketId, changed: false };

    await tx.update(tickets).set(updates).where(eq(tickets.id, ticketId));
    await tx.insert(ticketEvents).values(events);

    // SLA hooks run in the same transaction, before the score recompute
    // (score reads SLA state).
    const effectiveStatusId = updates.statusId ?? current.statusId;
    if (effectiveStatusId !== current.statusId) {
      const [oldS] = await tx.select().from(statuses).where(eq(statuses.id, current.statusId));
      const [newS] = await tx.select().from(statuses).where(eq(statuses.id, effectiveStatusId));
      if (oldS && newS && oldS.category !== newS.category) {
        await onStatusCategoryChange(tx as unknown as typeof db, ticketId, oldS.category, newS.category);
      }
    }
    if (updates.priority !== undefined) {
      await onPriorityChange(tx as unknown as typeof db, ticketId, updates.priority as number);
    }

    await recomputeScore(tx as unknown as typeof db, ticketId);
    return { ticketId, changed: true };
  });
}

/**
 * Create a ticket through the full intake pipeline: insert + created event,
 * routing rules, SLA attachment. AI enrichment is fired by the caller
 * (off the request path). Shared by the portal route and inbound email.
 */
export async function createTicketCore(input: {
  subject: string;
  description: string;
  requesterId: number;
  source: 'portal' | 'email' | 'agent' | 'api';
  type?: 'incident' | 'request' | 'change';
  priority?: number;
}) {
  const [defaultStatus] = await db.select().from(statuses).where(eq(statuses.isDefault, true)).limit(1);
  const [defaultQueue] = await db.select().from(teams).orderBy(teams.id).limit(1);
  if (!defaultStatus || !defaultQueue) throw new Error('no default status/queue configured');

  const [created] = await db.insert(tickets).values({
    subject: input.subject,
    description: input.description,
    type: input.type ?? 'incident',
    priority: input.priority ?? 3,
    statusId: defaultStatus.id,
    queueId: defaultQueue.id,
    requesterId: input.requesterId,
    source: input.source,
  }).returning();

  await db.insert(ticketEvents).values({
    ticketId: created!.id, actorId: input.requesterId, actorType: 'user', eventType: 'created',
    field: 'source', newValue: input.source,
  });

  // Deferred imports avoid a routing/SLA <-> ticketService import cycle.
  const { applyRoutingRules } = await import('./routing.js');
  const { attachSlas } = await import('./sla/slaService.js');
  await applyRoutingRules(created!.id).catch(() => {});
  const [routed] = await db.select({ priority: tickets.priority }).from(tickets).where(eq(tickets.id, created!.id));
  await attachSlas(db, created!.id, routed?.priority ?? created!.priority);

  return created!;
}

/**
 * Rank agents by fit for a ticket: skill level for its category (earned or
 * manual), queue membership, and load headroom.
 *   fit = skillBase(level) × queueFactor × headroomFactor
 * Skilled L3 / in-queue / idle ≈ 100%; unskilled queue members are weak
 * fallbacks (< 50%).
 */
export async function bestFitAgents(ticketId: number, limit = 3) {
  const [t] = await db
    .select({ queueId: tickets.queueId, categoryName: categories.name })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .where(eq(tickets.id, ticketId));
  if (!t) return [];

  const rows = (await db.execute(sql`
    select u.id, u.name, u.max_open_assignments as cap,
      (select ag.level from agent_skills ag
        join skills s on s.id = ag.skill_id
        where ag.user_id = u.id and s.name = ${t.categoryName ?? ''}) as level,
      exists(select 1 from team_memberships tm
        where tm.user_id = u.id and tm.team_id = ${t.queueId}) as in_queue,
      (select count(*) from tickets tk
        join statuses st on st.id = tk.status_id
        where tk.assignee_id = u.id and st.category not in ('resolved','closed')) as open
    from users u
    where u.role in ('agent','admin') and u.is_active and u.is_available
  `)).rows as { id: number; name: string; cap: number; level: number | null; in_queue: boolean; open: number }[];

  return rows
    .map((r) => {
      const skillBase = r.level ? 0.55 + 0.15 * r.level : r.in_queue ? 0.35 : 0.15;
      const queueFactor = r.in_queue ? 1 : 0.8;
      const headroom = 0.6 + 0.4 * (1 - Math.min(Number(r.open) / r.cap, 1));
      return {
        id: Number(r.id),
        name: r.name,
        fit: Math.round(skillBase * queueFactor * headroom * 100) / 100,
        level: r.level,
        inQueue: r.in_queue,
      };
    })
    .sort((a, b) => b.fit - a.fit)
    .slice(0, limit);
}

/**
 * Expertise-based auto-assign: match the ticket's category to agent skills
 * (earned from history or manually granted). Queue members are preferred,
 * then any skilled agent; ties break by skill level, then lightest load.
 * No qualified agent (or no category) leaves the ticket unassigned.
 */
export async function autoAssignByExpertise(ticketIds: number[], actor: Actor) {
  const results: { ticketId: number; assigneeId: number | null; skill?: string }[] = [];
  for (const ticketId of ticketIds) {
    const [t] = await db
      .select({
        queueId: tickets.queueId, categoryId: tickets.categoryId,
        categoryName: categories.name,
      })
      .from(tickets)
      .leftJoin(categories, eq(categories.id, tickets.categoryId))
      .where(eq(tickets.id, ticketId));
    if (!t?.categoryName) {
      results.push({ ticketId, assigneeId: null });
      continue;
    }

    const candidates = await db
      .select({
        userId: users.id,
        level: agentSkills.level,
        cap: users.maxOpenAssignments,
        inQueue: sql<boolean>`exists (
          select 1 from team_memberships tm
          where tm.user_id = users.id and tm.team_id = ${t.queueId}
        )`,
        openCount: sql<number>`(
          select count(*) from tickets tk
          join statuses st on st.id = tk.status_id
          where tk.assignee_id = users.id
            and st.category not in ('resolved','closed')
        )`.mapWith(Number),
      })
      .from(agentSkills)
      .innerJoin(users, eq(users.id, agentSkills.userId))
      .innerJoin(skills, eq(skills.id, agentSkills.skillId))
      .where(and(
        eq(skills.name, t.categoryName),
        eq(users.isActive, true),
        eq(users.isAvailable, true),
      ));

    const pick = candidates
      .filter((c) => c.openCount < c.cap)
      .sort((a, b) =>
        Number(b.inQueue) - Number(a.inQueue) || b.level - a.level || a.openCount - b.openCount,
      )[0];

    if (pick) {
      await applyTicketChanges(ticketId, { ...actor, type: 'system' }, { assigneeId: pick.userId });
      await db.insert(ticketEvents).values({
        ticketId, actorId: null, actorType: 'system', eventType: 'assigned_by_expertise',
        field: 'skill', newValue: `${t.categoryName} L${pick.level}`,
      });
    }
    results.push({ ticketId, assigneeId: pick?.userId ?? null, skill: pick ? t.categoryName : undefined });
  }
  return results;
}

/**
 * Round-robin auto-assign within each ticket's queue. Advisory lock per queue
 * protects the rotation pointer from concurrent assignment.
 */
export async function autoAssign(ticketIds: number[], actor: Actor) {
  const results: { ticketId: number; assigneeId: number | null }[] = [];
  for (const ticketId of ticketIds) {
    const assigneeId = await db.transaction(async (tx) => {
      const [t] = await tx.select({ queueId: tickets.queueId }).from(tickets).where(eq(tickets.id, ticketId));
      if (!t) return null;
      await tx.execute(sql`select pg_advisory_xact_lock(${t.queueId})`);

      const members = await tx
        .select({ userId: teamMemberships.userId, openCount: sql<number>`(
          select count(*) from tickets tk
          join statuses st on st.id = tk.status_id
          where tk.assignee_id = team_memberships.user_id
            and st.category not in ('resolved','closed')
        )`.mapWith(Number) })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(and(eq(teamMemberships.teamId, t.queueId), eq(users.isAvailable, true), eq(users.isActive, true)))
        .orderBy(teamMemberships.userId);
      if (members.length === 0) return null;

      const [team] = await tx.select().from(teams).where(eq(teams.id, t.queueId));
      const capped = await tx.select({ cap: users.maxOpenAssignments, id: users.id }).from(users)
        .where(inArray(users.id, members.map((m) => m.userId)));
      const capOf = new Map(capped.map((c) => [c.id, c.cap]));
      const eligible = members.filter((m) => m.openCount < (capOf.get(m.userId) ?? 25));
      if (eligible.length === 0) return null; // everyone capped — stays unassigned by design

      // Rotate: first eligible member after the pointer.
      const lastIdx = eligible.findIndex((m) => m.userId === team?.lastAssignedUserId);
      const next = eligible[(lastIdx + 1) % eligible.length]!;
      await tx.update(teams).set({ lastAssignedUserId: next.userId }).where(eq(teams.id, t.queueId));
      return next.userId;
    });

    if (assigneeId != null) {
      await applyTicketChanges(ticketId, { ...actor, type: 'system' }, { assigneeId });
    }
    results.push({ ticketId, assigneeId });
  }
  return results;
}
