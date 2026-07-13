import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { applyTicketChanges, autoAssign, type TicketChanges } from '../services/ticketService.js';
import { enrichTicket } from '../services/ai/enrichment.js';

const { tickets, statuses, teams, users, ticketTags, tags, slaInstances, ticketComments, ticketEvents, categories } = schema;

const listQuery = z.object({
  view: z.enum(['open', 'mine', 'unassigned', 'my_queues', 'snoozed', 'all']).default('open'),
  queueId: z.coerce.number().optional(),
  sort: z.enum(['date', 'score', 'priority', 'requester', 'description', 'random']).default('date'),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
});

const changesBody = z.object({
  assigneeId: z.number().nullable().optional(),
  queueId: z.number().optional(),
  statusId: z.number().optional(),
  priority: z.number().min(1).max(4).optional(),
  snooze: z.object({ until: z.string(), reason: z.string().max(500) }).nullable().optional(),
  manualBoost: z.number().min(-10).max(10).optional(),
});

export async function ticketRoutes(app: FastifyInstance) {
  const requester = alias(users, 'requester');
  const assignee = alias(users, 'assignee');

  app.get('/api/tickets', async (req) => {
    const q = listQuery.parse(req.query);

    const conds: SQL[] = [];
    if (q.view === 'open' || q.view === 'mine' || q.view === 'unassigned' || q.view === 'my_queues') {
      conds.push(sql`${statuses.category} not in ('resolved','closed')`);
      conds.push(sql`(${tickets.snoozedUntil} is null or ${tickets.snoozedUntil} <= now())`);
    }
    if (q.view === 'mine') conds.push(eq(tickets.assigneeId, req.userId));
    if (q.view === 'unassigned') conds.push(sql`${tickets.assigneeId} is null`);
    if (q.view === 'my_queues') {
      conds.push(sql`${tickets.queueId} in (
        select team_id from team_memberships where user_id = ${req.userId}
      )`);
    }
    if (q.view === 'snoozed') {
      conds.push(sql`${statuses.category} not in ('resolved','closed')`);
      conds.push(sql`${tickets.snoozedUntil} > now()`);
    }
    if (q.queueId) conds.push(eq(tickets.queueId, q.queueId));
    if (q.search) {
      conds.push(or(ilike(tickets.subject, `%${q.search}%`), ilike(tickets.number, `%${q.search}%`))!);
    }

    const order =
      q.sort === 'score' ? [desc(tickets.score), desc(tickets.createdAt)]
      : q.sort === 'priority' ? [asc(tickets.priority), desc(tickets.score)]
      : q.sort === 'requester' ? [asc(requester.name), desc(tickets.createdAt)]
      : q.sort === 'description' ? [asc(tickets.subject)]
      : q.sort === 'random' ? [sql`random()`]
      : [desc(tickets.createdAt)];

    const rows = await db
      .select({
        id: tickets.id, number: tickets.number, type: tickets.type,
        subject: tickets.subject, priority: tickets.priority, score: tickets.score,
        createdAt: tickets.createdAt, updatedAt: tickets.updatedAt,
        snoozedUntil: tickets.snoozedUntil, snoozeReason: tickets.snoozeReason,
        status: { id: statuses.id, name: statuses.name, category: statuses.category },
        queue: { id: teams.id, name: teams.name },
        requester: { id: requester.id, name: requester.name, isVip: requester.isVip },
        assignee: { id: assignee.id, name: assignee.name },
        category: categories.name,
      })
      .from(tickets)
      .innerJoin(statuses, eq(statuses.id, tickets.statusId))
      .innerJoin(teams, eq(teams.id, tickets.queueId))
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(categories, eq(categories.id, tickets.categoryId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(q.limit);

    const ids = rows.map((r) => r.id);
    const tagRows = ids.length
      ? await db.select({ ticketId: ticketTags.ticketId, name: tags.name })
          .from(ticketTags).innerJoin(tags, eq(tags.id, ticketTags.tagId))
          .where(inArray(ticketTags.ticketId, ids))
      : [];
    const slaRows = ids.length
      ? await db.select({
          ticketId: slaInstances.ticketId, state: slaInstances.state,
          targetAt: slaInstances.targetAt, warnAt: slaInstances.warnAt,
        })
          .from(slaInstances)
          .where(and(inArray(slaInstances.ticketId, ids), eq(slaInstances.metric, 'resolution')))
      : [];

    const tagsByTicket = new Map<number, string[]>();
    for (const t of tagRows) {
      (tagsByTicket.get(t.ticketId) ?? tagsByTicket.set(t.ticketId, []).get(t.ticketId)!).push(t.name);
    }
    const slaByTicket = new Map(slaRows.map((s) => [s.ticketId, s]));

    return rows.map((r) => ({
      ...r,
      tags: tagsByTicket.get(r.id) ?? [],
      sla: slaByTicket.get(r.id) ?? null,
    }));
  });

  app.get('/api/tickets/:id', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [t] = await db
      .select({
        id: tickets.id, number: tickets.number, type: tickets.type,
        subject: tickets.subject, description: tickets.description,
        priority: tickets.priority, score: tickets.score, manualBoost: tickets.manualBoost,
        createdAt: tickets.createdAt, updatedAt: tickets.updatedAt,
        firstRespondedAt: tickets.firstRespondedAt, resolvedAt: tickets.resolvedAt,
        snoozedUntil: tickets.snoozedUntil, snoozeReason: tickets.snoozeReason,
        source: tickets.source, customFields: tickets.customFields,
        status: { id: statuses.id, name: statuses.name, category: statuses.category },
        queue: { id: teams.id, name: teams.name },
        requester: { id: requester.id, name: requester.name, isVip: requester.isVip, department: requester.department, email: requester.email },
        assignee: { id: assignee.id, name: assignee.name },
        category: categories.name,
      })
      .from(tickets)
      .innerJoin(statuses, eq(statuses.id, tickets.statusId))
      .innerJoin(teams, eq(teams.id, tickets.queueId))
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(categories, eq(categories.id, tickets.categoryId))
      .where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });

    const author = alias(users, 'author');
    const comments = await db
      .select({
        id: ticketComments.id, visibility: ticketComments.visibility,
        bodyText: ticketComments.bodyText, source: ticketComments.source,
        createdAt: ticketComments.createdAt,
        author: { id: author.id, name: author.name },
      })
      .from(ticketComments)
      .innerJoin(author, eq(author.id, ticketComments.authorId))
      .where(eq(ticketComments.ticketId, id))
      .orderBy(asc(ticketComments.createdAt));

    const actor = alias(users, 'actor');
    const events = await db
      .select({
        id: ticketEvents.id, actorType: ticketEvents.actorType,
        eventType: ticketEvents.eventType, field: ticketEvents.field,
        oldValue: ticketEvents.oldValue, newValue: ticketEvents.newValue,
        createdAt: ticketEvents.createdAt,
        actorName: actor.name,
      })
      .from(ticketEvents)
      .leftJoin(actor, eq(actor.id, ticketEvents.actorId))
      .where(eq(ticketEvents.ticketId, id))
      .orderBy(asc(ticketEvents.createdAt));

    const sla = await db.select().from(slaInstances).where(eq(slaInstances.ticketId, id));
    const tagRows = await db.select({ name: tags.name })
      .from(ticketTags).innerJoin(tags, eq(tags.id, ticketTags.tagId))
      .where(eq(ticketTags.ticketId, id));
    const [ai] = await db.select().from(schema.aiEnrichments)
      .where(and(eq(schema.aiEnrichments.ticketId, id), eq(schema.aiEnrichments.feature, 'triage')))
      .orderBy(desc(schema.aiEnrichments.createdAt))
      .limit(1);

    return { ...t, comments, events, sla, tags: tagRows.map((r) => r.name), ai: ai ?? null };
  });

  app.post('/api/tickets', async (req, reply) => {
    const body = z.object({
      subject: z.string().trim().min(3).max(300),
      description: z.string().trim().min(1).max(20_000),
      type: z.enum(['incident', 'request', 'change']).default('incident'),
      priority: z.number().min(1).max(4).default(3),
    }).parse(req.body);

    const [defaultStatus] = await db.select().from(statuses)
      .where(eq(statuses.isDefault, true)).limit(1);
    const [defaultQueue] = await db.select().from(teams).orderBy(teams.id).limit(1);
    if (!defaultStatus || !defaultQueue) {
      return reply.status(500).send({ error: 'no default status/queue configured' });
    }

    const [created] = await db.insert(tickets).values({
      subject: body.subject,
      description: body.description,
      type: body.type,
      priority: body.priority,
      statusId: defaultStatus.id,
      queueId: defaultQueue.id,
      requesterId: req.userId,
      source: 'portal',
    }).returning();

    await db.insert(schema.ticketEvents).values({
      ticketId: created!.id, actorId: req.userId, actorType: 'user', eventType: 'created',
    });

    // AI enrichment runs off the request path — categorization/queue/priority
    // land seconds later as audited 'ai' events (or a pending suggestion).
    enrichTicket(created!.id, 'auto').catch((err) =>
      app.log.warn({ err, ticketId: created!.id }, 'ai enrichment failed'),
    );

    return created;
  });

  app.patch('/api/tickets/:id', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const changes = changesBody.parse(req.body) as TicketChanges;
    return applyTicketChanges(id, { id: req.userId }, changes);
  });

  app.post('/api/tickets/:id/comments', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      bodyText: z.string().trim().min(1).max(10_000),
      visibility: z.enum(['public', 'internal']).default('public'),
    }).parse(req.body);
    const [comment] = await db.insert(ticketComments).values({
      ticketId: id, authorId: req.userId, visibility: body.visibility,
      bodyText: body.bodyText, source: 'agent',
    }).returning();
    // First public agent reply stamps first_responded_at.
    if (body.visibility === 'public') {
      await db.update(tickets)
        .set({ firstRespondedAt: sql`coalesce(${tickets.firstRespondedAt}, now())`, updatedAt: new Date() })
        .where(eq(tickets.id, id));
    }
    return comment;
  });

  app.post('/api/tickets/bulk', async (req) => {
    const body = z.object({
      ticketIds: z.array(z.number()).min(1).max(100),
      action: z.enum(['update', 'auto_assign']).default('update'),
      changes: changesBody.optional(),
    }).parse(req.body);

    if (body.action === 'auto_assign') {
      return autoAssign(body.ticketIds, { id: req.userId });
    }
    if (!body.changes) throw Object.assign(new Error('changes required'), { statusCode: 400 });
    const results = [];
    for (const ticketId of body.ticketIds) {
      results.push(await applyTicketChanges(ticketId, { id: req.userId }, body.changes as TicketChanges));
    }
    return results;
  });
}
