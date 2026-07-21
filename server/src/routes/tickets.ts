import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { applyTicketChanges, autoAssign, autoAssignByExpertise, autoAssignByMention, bestFitAgents, detectMentionedAgent, createTicketCore, type TicketChanges } from '../services/ticketService.js';
import { enrichTicket } from '../services/ai/enrichment.js';
import { completeFirstResponse } from '../services/sla/slaService.js';
import { templatesForTicket } from '../services/templates.js';
import { activeIncidents, broadcastIncidentUpdate, incidentInfo, resolveIncidentCascade } from '../services/incidents.js';
import { requireAdmin, requireStaff, requireStaffRead } from './guards.js';

const { tickets, statuses, teams, users, ticketTags, tags, slaInstances, ticketComments, ticketEvents, categories } = schema;

const listQuery = z.object({
  view: z.enum(['open', 'mine', 'unassigned', 'my_queues', 'snoozed', 'closed', 'all']).default('open'),
  queueId: z.coerce.number().optional(),
  assigneeId: z.coerce.number().optional(),
  requesterId: z.coerce.number().optional(),
  sort: z.enum(['date', 'newest', 'score', 'priority', 'requester', 'description', 'random']).default('date'),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
  // Structured filters — mostly fed by natural-language search.
  categoryId: z.coerce.number().optional(),
  tags: z.string().trim().max(240).optional(), // comma-separated, ANDed
  olderThanDays: z.coerce.number().min(0).max(3650).optional(),
  newerThanDays: z.coerce.number().min(0).max(3650).optional(),
  priorityAtMost: z.coerce.number().min(1).max(4).optional(),
  unassigned: z.enum(['1']).optional(),
  // Scope any view to the queues the caller's teams own (the queue
  // dropdown's "My queues" aggregate) — composes with view, unlike my_queues.
  myQueues: z.enum(['1']).optional(),
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
  const submitter = alias(users, 'submitter');

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
    if (q.view === 'closed') {
      conds.push(sql`${statuses.category} in ('resolved','closed')`);
    }
    if (q.queueId) conds.push(eq(tickets.queueId, q.queueId));
    if (q.assigneeId) conds.push(eq(tickets.assigneeId, q.assigneeId));
    if (q.requesterId) conds.push(eq(tickets.requesterId, q.requesterId));
    // RBAC: requesters only ever see tickets they own or filed for someone.
    if (req.userRole === 'requester') {
      conds.push(or(eq(tickets.requesterId, req.userId), eq(tickets.submittedById, req.userId))!);
    }
    // Admin-restricted staff ('own' queue visibility) see only the queues
    // their teams own, whatever filters they ask for.
    if (req.userRole !== 'requester' && req.userQueueVisibility === 'own') {
      conds.push(sql`${tickets.queueId} in (
        select team_id from team_memberships where user_id = ${req.userId}
      )`);
    }
    if (q.search) {
      // Word-AND, not exact phrase: "zebra label" matches "Zebra label
      // printer offset" even though the words aren't adjacent. Each word
      // may match the subject or a ticket/legacy number.
      for (const word of q.search.split(/\s+/).filter(Boolean).slice(0, 8)) {
        conds.push(or(
          ilike(tickets.subject, `%${word}%`),
          ilike(tickets.number, `%${word}%`),
          ilike(tickets.legacyNumber, `%${word}%`), // imported SNOW numbers resolve too
        )!);
      }
    }
    if (q.categoryId) conds.push(eq(tickets.categoryId, q.categoryId));
    for (const tag of (q.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      conds.push(sql`exists (select 1 from ticket_tags tt join tags tg on tg.id = tt.tag_id
        where tt.ticket_id = ${tickets.id} and tg.name = ${tag})`);
    }
    if (q.olderThanDays) conds.push(sql`${tickets.createdAt} < now() - make_interval(days => ${q.olderThanDays})`);
    if (q.newerThanDays) conds.push(sql`${tickets.createdAt} > now() - make_interval(days => ${q.newerThanDays})`);
    if (q.priorityAtMost) conds.push(sql`${tickets.priority} <= ${q.priorityAtMost}`);
    if (q.unassigned === '1') conds.push(sql`${tickets.assigneeId} is null`);
    if (q.myQueues === '1') {
      conds.push(sql`${tickets.queueId} in (
        select team_id from team_memberships where user_id = ${req.userId}
      )`);
    }

    const order =
      q.sort === 'newest' ? [desc(tickets.id)] // arrival order, immune to backdated timestamps
      : q.sort === 'score' ? [desc(tickets.score), desc(tickets.createdAt)]
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
        requester: {
          id: requester.id, name: requester.name,
          // Effective VIP for THIS ticket's queue (global or per-queue).
          isVip: sql<boolean>`${requester.isVip} or exists (
            select 1 from queue_vips qv
            where qv.user_id = ${requester.id} and qv.team_id = ${tickets.queueId}
          )`,
        },
        assignee: { id: assignee.id, name: assignee.name },
        submittedBy: { id: submitter.id, name: submitter.name },
        category: categories.name,
        customFields: tickets.customFields,
      })
      .from(tickets)
      .innerJoin(statuses, eq(statuses.id, tickets.statusId))
      .innerJoin(teams, eq(teams.id, tickets.queueId))
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(submitter, eq(submitter.id, tickets.submittedById))
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

    return rows.map(({ customFields, ...r }) => ({
      ...r,
      flags: ((customFields as any)?.flaggedKeywords ?? []) as { term: string; boost: number }[],
      sentiment: ((customFields as any)?.sentimentFlag ?? null) as string | null,
      shouting: Boolean((customFields as any)?.shouting),
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
        legacyNumber: tickets.legacyNumber,
        csatRating: tickets.csatRating, csatComment: tickets.csatComment,
        status: { id: statuses.id, name: statuses.name, category: statuses.category },
        queue: { id: teams.id, name: teams.name },
        requester: {
          id: requester.id, name: requester.name, department: requester.department, email: requester.email,
          isVip: sql<boolean>`${requester.isVip} or exists (
            select 1 from queue_vips qv
            where qv.user_id = ${requester.id} and qv.team_id = ${tickets.queueId}
          )`,
        },
        assignee: { id: assignee.id, name: assignee.name },
        submittedBy: { id: submitter.id, name: submitter.name },
        category: categories.name,
      })
      .from(tickets)
      .innerJoin(statuses, eq(statuses.id, tickets.statusId))
      .innerJoin(teams, eq(teams.id, tickets.queueId))
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(submitter, eq(submitter.id, tickets.submittedById))
      .leftJoin(categories, eq(categories.id, tickets.categoryId))
      .where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });

    // Admin-restricted staff can't open tickets outside their queues.
    if (req.userRole !== 'requester' && req.userQueueVisibility === 'own') {
      const [member] = (await db.execute(sql`
        select 1 from team_memberships where user_id = ${req.userId} and team_id = ${t.queue.id}
      `)).rows;
      if (!member) return reply.status(403).send({ error: 'queue not visible to you' });
    }

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

    const approvalRows = await db
      .select({
        id: schema.approvals.id, state: schema.approvals.state, note: schema.approvals.note,
        approverId: schema.approvals.approverId, decidedAt: schema.approvals.decidedAt,
        approverName: sql<string>`(select name from users au where au.id = ${schema.approvals.approverId})`,
        decidedByName: sql<string | null>`(select name from users du where du.id = ${schema.approvals.decidedById})`,
        targetQueue: sql<string | null>`(select name from teams tq where tq.id = ${schema.approvals.targetQueueId})`,
      })
      .from(schema.approvals)
      .where(eq(schema.approvals.ticketId, id))
      .orderBy(desc(schema.approvals.createdAt));

    const incident = await incidentInfo(id);

    const watchers = await db
      .select({ userId: schema.ticketWatchers.userId, name: users.name })
      .from(schema.ticketWatchers)
      .innerJoin(users, eq(users.id, schema.ticketWatchers.userId))
      .where(eq(schema.ticketWatchers.ticketId, id));
    const watching = watchers.some((w) => w.userId === req.userId);

    const { attachmentsForTicket } = await import('./attachments.js');
    const attachmentRows = await attachmentsForTicket(id);

    // RBAC: requesters see only their own tickets, without internal notes,
    // the audit trail, AI internals, or SLA state.
    if (req.userRole === 'requester') {
      if (t.requester.id !== req.userId && (t as any).submittedBy?.id !== req.userId) {
        return reply.status(403).send({ error: 'not your ticket' });
      }
      return {
        ...t,
        comments: comments.filter((c) => c.visibility === 'public'),
        events: [], sla: [],
        // Enough AI state for the post-submit routing screen, nothing more.
        ai: ai ? {
          status: ai.status,
          confidence: { category: (ai.confidence as any)?.category ?? 0 },
          result: {
            category: (ai.result as any)?.category,
            summary: (ai.result as any)?.summary, // their own ticket's summary
          },
        } : null,
        tags: tagRows.map((r) => r.name),
        approvals: approvalRows,
        // other requesters' tickets stay private — no child/duplicate lists
        incident: { parent: incident.parent, mergedInto: incident.mergedInto, children: [], duplicates: [] },
        watching: false, watcherCount: 0, watchers: [], // agent feature
        attachments: attachmentRows,
      };
    }

    return {
      ...t, comments, events, sla, tags: tagRows.map((r) => r.name),
      ai: ai ?? null, approvals: approvalRows, incident,
      watching, watcherCount: watchers.length,
      watchers: watchers.map((w) => ({ id: w.userId, name: w.name })),
      attachments: attachmentRows,
    };
  });

  app.post('/api/tickets', async (req) => {
    const body = z.object({
      // Optional — a blank subject gets an interim snippet here and a real
      // AI-written one when triage lands (same for hopelessly vague ones).
      subject: z.string().trim().max(300).default(''),
      description: z.string().trim().min(1).max(20_000),
      type: z.enum(['incident', 'request', 'change']).default('incident'),
      priority: z.number().min(1).max(4).default(3),
      onBehalfOfId: z.number().optional(), // file for another user
      // The dialog uploads attachments right after create; holding triage
      // until they land lets the model see the screenshots.
      holdTriage: z.boolean().default(false),
    }).parse(req.body);

    const { onBehalfOfId, holdTriage, ...ticketBody } = body;
    if (!ticketBody.subject) {
      const words = ticketBody.description.split(/\s+/);
      ticketBody.subject = words.slice(0, 10).join(' ').slice(0, 80) + (words.length > 10 ? '…' : '');
    }
    const created = await createTicketCore({
      ...ticketBody,
      requesterId: onBehalfOfId ?? req.userId,
      submittedById: onBehalfOfId ? req.userId : undefined,
      source: 'portal',
    });

    // AI enrichment runs off the request path — categorization/queue/priority
    // land seconds later as audited 'ai' events (or a pending suggestion).
    // With holdTriage the client kicks /triage-now after attachments land.
    if (!holdTriage) {
      enrichTicket(created.id, 'auto').catch((err) =>
        app.log.warn({ err, ticketId: created.id }, 'ai enrichment failed'),
      );
    }

    return created;
  });

  // Fire held-back triage once attachments are uploaded (screenshots go to
  // the model). Owner or staff; once — repeat calls are ignored if triage
  // already ran.
  app.post('/api/tickets/:id/triage-now', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [t] = await db.select({ requesterId: tickets.requesterId, submittedById: tickets.submittedById })
      .from(tickets).where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });
    const isOwner = t.requesterId === req.userId || t.submittedById === req.userId;
    if (!isOwner && req.userRole !== 'admin' && req.userRole !== 'agent') {
      return reply.status(403).send({ error: 'not your ticket' });
    }
    const [existing] = await db.select({ id: schema.aiEnrichments.id }).from(schema.aiEnrichments)
      .where(and(eq(schema.aiEnrichments.ticketId, id), eq(schema.aiEnrichments.feature, 'triage')));
    if (existing) return { ok: true, alreadyTriaged: true };
    enrichTicket(id, 'auto').catch((err) =>
      app.log.warn({ err, ticketId: id }, 'ai enrichment failed'));
    return { ok: true };
  });

  // Top agents for this ticket by expertise/queue/load fit. An agent named
  // in the ticket text leads the list regardless of fit (gold ring in the UI).
  app.get('/api/tickets/:id/fit', async (req) => {
    requireStaffRead(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [all, mention] = await Promise.all([bestFitAgents(id, 200), detectMentionedAgent(id)]);
    const top = all.slice(0, 3);
    const m = mention && all.find((a) => a.id === mention.id);
    if (!m) return top;
    return [
      { ...m, mentioned: true, snippet: mention!.snippet },
      ...top.filter((a) => a.id !== m.id).slice(0, 2),
    ];
  });

  // Response templates rendered for this ticket ({{variables}} resolved),
  // matching-category templates first.
  app.get('/api/tickets/:id/templates', async (req) => {
    requireStaffRead(req);
    const id = z.coerce.number().parse((req.params as any).id);
    return templatesForTicket(id, req.userId);
  });

  app.patch('/api/tickets/:id', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const changes = changesBody.parse(req.body) as TicketChanges;
    const result = await applyTicketChanges(id, { id: req.userId }, changes);
    const cascaded = await cascadeIfResolvedParent(id, changes, req.userId);
    return cascaded ? { ...result, incidentResolved: cascaded } : result;
  });

  app.post('/api/tickets/:id/comments', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      bodyText: z.string().trim().min(1).max(10_000),
      visibility: z.enum(['public', 'internal']).default('public'),
    }).parse(req.body);

    // RBAC: requesters reply publicly on their own tickets only; a reply on
    // a resolved/closed ticket reopens it (same behavior as email replies).
    if (req.userRole === 'requester') {
      const [t] = await db.select({
        requesterId: tickets.requesterId, submittedById: tickets.submittedById,
        statusId: tickets.statusId,
      }).from(tickets).where(eq(tickets.id, id));
      if (!t || (t.requesterId !== req.userId && t.submittedById !== req.userId)) {
        return reply.status(403).send({ error: 'not your ticket' });
      }
      const [comment] = await db.insert(ticketComments).values({
        ticketId: id, authorId: req.userId, visibility: 'public',
        bodyText: body.bodyText, source: 'portal',
      }).returning();
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
      // Guided intake awaiting answers? Parse the reply and route (async —
      // the reply itself shouldn't wait on the AI).
      const { handleIntakeReply } = await import('../services/intake.js');
      handleIntakeReply(id).catch((e) => console.error(`[intake] reply handling failed for ticket ${id}:`, e));
      // Deflection offer outstanding? "solved" closes it; anything else
      // hands the ticket to an agent.
      const { handleDeflectionReply } = await import('../services/deflection.js');
      handleDeflectionReply(id, body.bodyText).catch((e) => console.error(`[deflection] reply handling failed for ticket ${id}:`, e));
      const [status] = await db.select().from(statuses).where(eq(statuses.id, t.statusId));
      if (status && (status.category === 'resolved' || status.category === 'closed')) {
        const [openStatus] = await db.select().from(statuses)
          .where(eq(statuses.category, 'open')).orderBy(asc(statuses.position)).limit(1);
        if (openStatus) {
          await applyTicketChanges(id, { id: null, type: 'system' }, { statusId: openStatus.id });
        }
      }
      return comment;
    }

    requireStaff(req); // readonly viewers can look, not comment
    const [comment] = await db.insert(ticketComments).values({
      ticketId: id, authorId: req.userId, visibility: body.visibility,
      bodyText: body.bodyText, source: 'agent',
    }).returning();
    // First public agent reply stamps first_responded_at and completes the
    // first-response SLA clock.
    let broadcast = 0;
    if (body.visibility === 'public') {
      const [before] = await db.select({ firstRespondedAt: tickets.firstRespondedAt })
        .from(tickets).where(eq(tickets.id, id));
      await db.update(tickets)
        .set({ firstRespondedAt: sql`coalesce(${tickets.firstRespondedAt}, now())`, updatedAt: new Date() })
        .where(eq(tickets.id, id));
      if (!before?.firstRespondedAt) await completeFirstResponse(id);
      // Replying on an incident parent fans out to every linked requester.
      const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.userId));
      broadcast = await broadcastIncidentUpdate(id, body.bodyText, author?.name ?? 'the response team');

      // Bilingual requester: append a translation of the reply so they read
      // the answer in their own language (async — lands within seconds).
      const [tt] = await db.select({ customFields: tickets.customFields })
        .from(tickets).where(eq(tickets.id, id));
      const lang = (tt?.customFields as any)?.language;
      if (lang && lang !== 'en') {
        void (async () => {
          try {
            const { getAIProvider } = await import('../services/ai/provider.js');
            const out = await getAIProvider().translate({ text: body.bodyText, targetLanguage: lang });
            await db.insert(schema.aiUsage).values({
              feature: 'translate', model: out.model, ticketId: id,
              inputTokens: out.inputTokens, outputTokens: out.outputTokens,
            });
            await db.update(ticketComments)
              .set({ bodyText: `${body.bodyText}\n\n---\n\n🌐 ${out.result.translation}` })
              .where(eq(ticketComments.id, comment!.id));
          } catch (e) {
            console.error(`[translate] reply translation failed for ticket ${id}:`, e);
          }
        })();
      }
    }
    return { ...comment, broadcast };
  });

  // Follow / unfollow a ticket — watchers get bell notifications for
  // everything that happens on it. Pass userId to subscribe a colleague
  // ("loop my lead in"); the watcher_added event lands in their bell.
  app.post('/api/tickets/:id/watch', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      watch: z.boolean(),
      userId: z.number().optional(),
    }).parse(req.body);
    const [t] = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });

    const targetId = body.userId ?? req.userId;
    if (targetId !== req.userId) {
      const [target] = await db.select({ role: users.role, name: users.name }).from(users)
        .where(and(eq(users.id, targetId), eq(users.isActive, true)));
      if (!target || (target.role !== 'agent' && target.role !== 'admin')) {
        return reply.status(400).send({ error: 'watchers must be agents or admins' });
      }
      if (!body.watch) {
        return reply.status(400).send({ error: 'only the watcher themself can unwatch' });
      }
      const inserted = await db.insert(schema.ticketWatchers)
        .values({ ticketId: id, userId: targetId })
        .onConflictDoNothing()
        .returning({ userId: schema.ticketWatchers.userId });
      if (inserted.length > 0) {
        // The event lands in the new watcher's bell via the watched branch.
        await db.insert(ticketEvents).values({
          ticketId: id, actorId: req.userId, actorType: 'user',
          eventType: 'watcher_added', field: 'watcher', newValue: target.name,
        });
      }
      return { ok: true, added: target.name, alreadyWatching: inserted.length === 0 };
    }

    if (body.watch) {
      await db.insert(schema.ticketWatchers).values({ ticketId: id, userId: req.userId })
        .onConflictDoNothing();
    } else {
      await db.delete(schema.ticketWatchers).where(and(
        eq(schema.ticketWatchers.ticketId, id), eq(schema.ticketWatchers.userId, req.userId)));
    }
    return { ok: true, watching: body.watch };
  });

  // Likely duplicates of this ticket, with the part-number check precomputed.
  app.get('/api/tickets/:id/merge-candidates', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const { mergeCandidates } = await import('../services/merge.js');
    return mergeCandidates(id);
  });

  // Merge this ticket (the duplicate) into a target. Mismatched part/order
  // numbers stop the merge until force=true — similar-looking codes are not
  // the same code.
  app.post('/api/tickets/:id/merge', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      targetId: z.number(),
      force: z.boolean().default(false),
    }).parse(req.body);
    const { mergeTickets } = await import('../services/merge.js');
    return mergeTickets(id, body.targetId, req.userId, body.force);
  });

  // Agent flags from the expanded ticket: wrong category (feeds the AI
  // learning loop), needs manager approval (forces the gate), misrouted
  // (back to intake for re-triage), or wrong user (ticket is really for
  // someone else — swaps the requester, also feeds the learning loop).
  // Always audited; note becomes an internal comment.
  app.post('/api/tickets/:id/flag', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      kind: z.enum(['wrong_category', 'needs_approval', 'misrouted', 'wrong_user', 'incident']),
      categoryId: z.number().optional(),
      userId: z.number().optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body);

    const [t] = await db.select({ id: tickets.id, number: tickets.number })
      .from(tickets).where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });

    let message = '';
    if (body.kind === 'wrong_category') {
      if (body.categoryId) {
        const [cat] = await db.select({ name: categories.name }).from(categories)
          .where(eq(categories.id, body.categoryId));
        if (!cat) return reply.status(400).send({ error: 'no such category' });
        // Route through the correction pipeline when the AI classified this
        // ticket — the correction becomes a pattern future triage follows.
        const [enrichment] = await db.select({ id: schema.aiEnrichments.id })
          .from(schema.aiEnrichments)
          .where(and(eq(schema.aiEnrichments.ticketId, id), eq(schema.aiEnrichments.feature, 'triage')))
          .orderBy(desc(schema.aiEnrichments.createdAt)).limit(1);
        if (enrichment) {
          const { correctEnrichment } = await import('../services/ai/enrichment.js');
          await correctEnrichment(enrichment.id, req.userId, { categoryId: body.categoryId });
          message = `Recategorized to ${cat.name} — the AI learns from this correction`;
        } else {
          await applyTicketChanges(id, { id: req.userId }, { categoryId: body.categoryId });
          message = `Recategorized to ${cat.name}`;
        }
      } else {
        message = 'Flagged for category review';
      }
    } else if (body.kind === 'wrong_user') {
      if (body.userId) {
        const [u] = await db.select({ name: users.name }).from(users)
          .where(and(eq(users.id, body.userId), eq(users.isActive, true)));
        if (!u) return reply.status(400).send({ error: 'no such user' });
        const { reassignRequester } = await import('../services/ticketService.js');
        const ok = await reassignRequester(id, body.userId, { id: req.userId });
        if (!ok) return reply.status(409).send({ error: 'ticket already belongs to that requester' });
        // When AI triage saw this ticket and missed the on-behalf-of, the
        // correction becomes a pattern future triage follows.
        const [enrichment] = await db.select({ id: schema.aiEnrichments.id })
          .from(schema.aiEnrichments)
          .where(and(eq(schema.aiEnrichments.ticketId, id), eq(schema.aiEnrichments.feature, 'triage')))
          .orderBy(desc(schema.aiEnrichments.createdAt)).limit(1);
        if (enrichment) {
          const { correctEnrichment } = await import('../services/ai/enrichment.js');
          await correctEnrichment(enrichment.id, req.userId, { onBehalfOf: u.name });
          message = `Requester changed to ${u.name} — the AI learns from this correction`;
        } else {
          message = `Requester changed to ${u.name} — SLAs and scoring follow them`;
        }
      } else {
        message = 'Flagged for requester review';
      }
    } else if (body.kind === 'incident') {
      // Declaring an incident raises a company-wide banner and cascades on
      // resolve — admin judgment only, not every agent.
      requireAdmin(req);
      // The human confidence gate: this ticket becomes the incident parent —
      // similar open tickets link under it, the company-wide banner goes up,
      // and new matching reports absorb automatically.
      const { declareIncidentManually } = await import('../services/incidents.js');
      const r = await declareIncidentManually(id, req.userId);
      message = r.children > 0
        ? `Incident declared — ${r.children} similar ticket${r.children === 1 ? '' : 's'} linked, company-wide banner is up`
        : 'Incident declared — banner is up; similar new reports will link automatically';
    } else if (body.kind === 'needs_approval') {
      const { maybeRequestApproval } = await import('../services/approvalService.js');
      const approval = await maybeRequestApproval(id, { force: true });
      if (!approval) return reply.status(409).send({ error: 'ticket already has an approval' });
      const [approver] = await db.select({ name: users.name }).from(users)
        .where(eq(users.id, approval.approverId));
      message = `Parked for approval — sent to ${approver?.name ?? 'the manager'}`;
    } else {
      const [intake] = await db.select({ id: teams.id, name: teams.name })
        .from(teams).orderBy(asc(teams.id)).limit(1);
      await applyTicketChanges(id, { id: req.userId }, {
        queueId: intake!.id, assigneeId: null,
      });
      message = `Sent back to ${intake!.name} for re-triage`;
    }

    await db.insert(ticketEvents).values({
      ticketId: id, actorId: req.userId, actorType: 'user', eventType: 'flagged',
      field: body.kind, newValue: body.note ?? undefined,
    });
    if (body.note) {
      await db.insert(ticketComments).values({
        ticketId: id, authorId: req.userId, visibility: 'internal',
        bodyText: `⚑ Flagged (${body.kind.replace('_', ' ')}): ${body.note}`, source: 'agent',
      });
    }
    return { ok: true, message };
  });

  // CSAT: the requester (or whoever filed it for them) rates a resolved or
  // closed ticket 1–5, once.
  app.post('/api/tickets/:id/csat', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(500).optional(),
    }).parse(req.body);

    const [t] = await db
      .select({
        requesterId: tickets.requesterId, submittedById: tickets.submittedById,
        csatRating: tickets.csatRating, statusCategory: statuses.category,
      })
      .from(tickets)
      .innerJoin(statuses, eq(statuses.id, tickets.statusId))
      .where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });
    if (t.requesterId !== req.userId && t.submittedById !== req.userId) {
      return reply.status(403).send({ error: 'only the requester can rate' });
    }
    if (t.statusCategory !== 'resolved' && t.statusCategory !== 'closed') {
      return reply.status(400).send({ error: 'rate after the ticket is resolved' });
    }
    if (t.csatRating != null) return reply.status(409).send({ error: 'already rated' });

    await db.update(tickets).set({
      csatRating: body.rating, csatComment: body.comment ?? null, csatAt: new Date(),
    }).where(eq(tickets.id, id));
    await db.insert(ticketEvents).values({
      ticketId: id, actorId: req.userId, actorType: 'user', eventType: 'csat_rated',
      field: 'csat', newValue: String(body.rating),
    });
    return { ok: true, rating: body.rating };
  });

  app.post('/api/tickets/bulk', async (req) => {
    requireStaff(req);
    const body = z.object({
      ticketIds: z.array(z.number()).min(1).max(100),
      action: z.enum(['update', 'auto_assign', 'expertise_assign', 'mentioned_assign']).default('update'),
      changes: changesBody.optional(),
    }).parse(req.body);

    if (body.action === 'auto_assign') {
      return autoAssign(body.ticketIds, { id: req.userId });
    }
    if (body.action === 'expertise_assign') {
      return autoAssignByExpertise(body.ticketIds, { id: req.userId });
    }
    if (body.action === 'mentioned_assign') {
      return autoAssignByMention(body.ticketIds, { id: req.userId });
    }
    if (!body.changes) throw Object.assign(new Error('changes required'), { statusCode: 400 });
    const results = [];
    for (const ticketId of body.ticketIds) {
      results.push(await applyTicketChanges(ticketId, { id: req.userId }, body.changes as TicketChanges));
      await cascadeIfResolvedParent(ticketId, body.changes as TicketChanges, req.userId);
    }
    return results;
  });

  // Open incident parents for the app-wide banner — visible to requesters
  // too (a known outage is exactly what stops duplicate filings).
  app.get('/api/incidents/active', async () => activeIncidents());
}

/** Status change landed on resolved/closed? If it's an incident parent, cascade. */
async function cascadeIfResolvedParent(ticketId: number, changes: TicketChanges, actorId: number) {
  if (changes.statusId === undefined) return 0;
  const [st] = await db.select().from(statuses).where(eq(statuses.id, changes.statusId));
  if (!st || (st.category !== 'resolved' && st.category !== 'closed')) return 0;
  return resolveIncidentCascade(ticketId, actorId);
}
