import type { FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAdmin } from './guards.js';
import { invalidateScoreWeightsCache, recomputeScore } from '../services/scoring.js';
import { runRecurringNow } from '../services/recurring.js';
import { deriveSkillsFromHistory } from '../services/skills.js';

const { appConfig, statuses, slaPolicies, routingRules, users, tickets, skills, agentSkills, responseTemplates, categories, teams, recurringTickets } = schema;



async function rescoreOpenTickets(): Promise<number> {
  const rows = await db.execute(sql`
    select t.id from tickets t join statuses s on s.id = t.status_id
    where s.category not in ('resolved','closed')
  `);
  for (const r of rows.rows as { id: number }[]) await recomputeScore(db, Number(r.id));
  return rows.rows.length;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/config', async (req) => {
    requireAdmin(req);
    const configRows = await db.select().from(appConfig);
    const byKey = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
    return {
      scoreWeights: byKey['score_weights'] ?? null,
      scoreKeywords: byKey['score_keywords'] ?? [],
      autoClose: byKey['auto_close'] ?? { days: 7 },
      escalation: byKey['escalation'] ?? {
        enabled: false,
        minutesByPriority: { '1': 30, '2': 120, '3': 480, '4': 1440 },
        expertiseScoreThreshold: 70,
      },
      aiThresholds: byKey['ai_thresholds'] ?? { autoApply: 0.8, suggest: 0.35 },
      businessHours: byKey['business_hours'] ?? null,
      statuses: await db.select().from(statuses).orderBy(asc(statuses.position)),
      skills: await db.select().from(skills).orderBy(asc(skills.name)),
      slaPolicies: await db.select().from(slaPolicies).orderBy(asc(slaPolicies.id)),
      routingRules: await db.select().from(routingRules).orderBy(asc(routingRules.position)),
      templates: await db.select().from(responseTemplates).orderBy(asc(responseTemplates.name)),
      queueNotifications: await db
        .select({ id: teams.id, name: teams.name, notifyEmails: teams.notifyEmails })
        .from(teams).orderBy(asc(teams.name)),
      recurring: await db
        .select({
          id: recurringTickets.id, name: recurringTickets.name,
          subject: recurringTickets.subject, type: recurringTickets.type,
          frequency: recurringTickets.frequency, enabled: recurringTickets.enabled,
          nextRunAt: recurringTickets.nextRunAt, lastRunAt: recurringTickets.lastRunAt,
        })
        .from(recurringTickets).orderBy(asc(recurringTickets.nextRunAt)),
      categories: await db.select({
        id: categories.id, name: categories.name, requiresApproval: categories.requiresApproval,
      }).from(categories).orderBy(asc(categories.name)),
    };
  });

  const templateBody = z.object({
    name: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(10_000),
    categoryId: z.number().nullable().default(null),
    autoRespond: z.boolean().default(false),
    isActive: z.boolean().default(true),
  });

  app.post('/api/admin/templates', async (req) => {
    requireAdmin(req);
    const body = templateBody.parse(req.body);
    const [created] = await db.insert(responseTemplates).values(body).returning();
    return created;
  });

  app.patch('/api/admin/templates/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = templateBody.partial().parse(req.body);
    const [updated] = await db.update(responseTemplates)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(responseTemplates.id, id)).returning();
    return updated;
  });

  // Recurring ticket schedules — filed through the normal intake pipeline
  // (routing, SLA, AI triage) when due.
  app.post('/api/admin/recurring', async (req) => {
    requireAdmin(req);
    const body = z.object({
      name: z.string().trim().min(3).max(120),
      subject: z.string().trim().min(3).max(300),
      description: z.string().trim().min(1).max(5000),
      type: z.enum(['incident', 'request', 'change']).default('request'),
      frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly']),
      firstRunAt: z.string().datetime(),
    }).parse(req.body);
    const [created] = await db.insert(recurringTickets).values({
      name: body.name, subject: body.subject, description: body.description,
      type: body.type, frequency: body.frequency,
      nextRunAt: new Date(body.firstRunAt),
      requesterId: req.userId, createdBy: req.userId,
    }).returning();
    return created;
  });

  app.patch('/api/admin/recurring/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const [updated] = await db.update(recurringTickets)
      .set({ enabled: body.enabled })
      .where(eq(recurringTickets.id, id)).returning();
    return updated;
  });

  app.delete('/api/admin/recurring/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    await db.delete(recurringTickets).where(eq(recurringTickets.id, id));
    return { ok: true };
  });

  // Manual fire — file an instance right now; the schedule itself is untouched.
  app.post('/api/admin/recurring/:id/run', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const ticket = await runRecurringNow(id);
    if (!ticket) {
      const err: any = new Error('schedule not found');
      err.statusCode = 404;
      throw err;
    }
    return { id: ticket.id, number: ticket.number };
  });

  // Staff users with their queue memberships + visibility, for the admin
  // "Users & Queues" panel.
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const staff = await db
      .select({
        id: users.id, name: users.name, role: users.role,
        queueVisibility: users.queueVisibility, isAvailable: users.isAvailable,
      })
      .from(users)
      .where(sql`${users.role} in ('agent','admin','readonly') and ${users.isActive}`)
      .orderBy(asc(users.name));
    const memberships = await db
      .select({
        userId: schema.teamMemberships.userId,
        teamId: schema.teamMemberships.teamId,
        role: schema.teamMemberships.role,
      })
      .from(schema.teamMemberships);
    const byUser = new Map<number, number[]>();
    const leadsByUser = new Map<number, number[]>();
    for (const m of memberships) {
      (byUser.get(m.userId) ?? byUser.set(m.userId, []).get(m.userId)!).push(m.teamId);
      if (m.role === 'lead') {
        (leadsByUser.get(m.userId) ?? leadsByUser.set(m.userId, []).get(m.userId)!).push(m.teamId);
      }
    }
    return staff.map((u) => ({
      ...u, teamIds: byUser.get(u.id) ?? [], leadTeamIds: leadsByUser.get(u.id) ?? [],
    }));
  });

  // Replace a user's queue memberships and/or set their queue visibility.
  // Lead status on kept memberships survives the replace.
  app.patch('/api/admin/users/:id/queues', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      teamIds: z.array(z.number()).max(50).optional(),
      queueVisibility: z.enum(['all', 'own']).optional(),
    }).parse(req.body);

    if (body.teamIds) {
      const existing = await db
        .select({ teamId: schema.teamMemberships.teamId, role: schema.teamMemberships.role })
        .from(schema.teamMemberships)
        .where(eq(schema.teamMemberships.userId, id));
      const roleOf = new Map(existing.map((m) => [m.teamId, m.role]));
      await db.delete(schema.teamMemberships).where(eq(schema.teamMemberships.userId, id));
      if (body.teamIds.length) {
        await db.insert(schema.teamMemberships)
          .values(body.teamIds.map((teamId) => ({ userId: id, teamId, role: roleOf.get(teamId) ?? 'member' })))
          .onConflictDoNothing();
      }
    }
    if (body.queueVisibility) {
      await db.update(users).set({ queueVisibility: body.queueVisibility }).where(eq(users.id, id));
      // Visibility rides the 30s role cache — changes land within half a minute.
    }
    return { ok: true };
  });

  // Change a user's role. Admins can't demote themselves — someone must
  // always hold the keys.
  app.patch('/api/admin/users/:id/role', async (req, reply) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ role: z.enum(['admin', 'agent', 'readonly']) }).parse(req.body);
    if (id === req.userId) {
      return reply.status(400).send({ error: "you can't change your own role" });
    }
    await db.update(users).set({ role: body.role }).where(eq(users.id, id));
    return { ok: true };
  });

  // Promote/demote a user as lead of one of their teams.
  app.patch('/api/admin/users/:id/lead', async (req, reply) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ teamId: z.number(), lead: z.boolean() }).parse(req.body);
    const [updated] = await db.update(schema.teamMemberships)
      .set({ role: body.lead ? 'lead' : 'member' })
      .where(sql`${schema.teamMemberships.userId} = ${id} and ${schema.teamMemberships.teamId} = ${body.teamId}`)
      .returning();
    if (!updated) return reply.status(400).send({ error: 'not a member of that queue' });
    return { ok: true };
  });

  // VIP management: global (users.is_vip) and per-queue (queue_vips).
  // Every change rescores the person's open tickets so the boost is live.
  async function rescoreRequesterOpen(userId: number) {
    const rows = (await db.execute(sql`
      select t.id from tickets t join statuses s on s.id = t.status_id
      where t.requester_id = ${userId} and s.category not in ('resolved','closed')
    `)).rows as { id: number }[];
    for (const r of rows) await recomputeScore(db, Number(r.id));
    return rows.length;
  }

  app.get('/api/admin/vips', async (req) => {
    requireAdmin(req);
    const globals = await db
      .select({ userId: users.id, name: users.name, department: users.department })
      .from(users).where(sql`${users.isVip} and ${users.isActive}`);
    const perQueue = (await db.execute(sql`
      select qv.user_id, u.name, u.department, qv.team_id, tm.name as team_name
      from queue_vips qv
      join users u on u.id = qv.user_id
      join teams tm on tm.id = qv.team_id
      order by u.name, tm.name
    `)).rows as { user_id: number; name: string; department: string | null; team_id: number; team_name: string }[];

    const byUser = new Map<number, { userId: number; name: string; department: string | null; global: boolean; queues: { id: number; name: string }[] }>();
    for (const g of globals) {
      byUser.set(g.userId, { userId: g.userId, name: g.name, department: g.department, global: true, queues: [] });
    }
    for (const q of perQueue) {
      const id = Number(q.user_id);
      const entry = byUser.get(id) ?? { userId: id, name: q.name, department: q.department, global: false, queues: [] };
      entry.queues.push({ id: Number(q.team_id), name: q.team_name });
      byUser.set(id, entry);
    }
    return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post('/api/admin/vips', async (req) => {
    requireAdmin(req);
    const body = z.object({
      userId: z.number(),
      teamId: z.number().nullable().default(null), // null = VIP everywhere
    }).parse(req.body);
    if (body.teamId == null) {
      await db.update(users).set({ isVip: true }).where(eq(users.id, body.userId));
    } else {
      await db.insert(schema.queueVips).values({ userId: body.userId, teamId: body.teamId }).onConflictDoNothing();
    }
    const rescored = await rescoreRequesterOpen(body.userId);
    return { ok: true, rescored };
  });

  app.delete('/api/admin/vips/:userId', async (req) => {
    requireAdmin(req);
    const userId = z.coerce.number().parse((req.params as any).userId);
    const q = z.object({ teamId: z.coerce.number().optional() }).parse(req.query);
    if (q.teamId == null) {
      await db.update(users).set({ isVip: false }).where(eq(users.id, userId));
    } else {
      await db.execute(sql`delete from queue_vips where user_id = ${userId} and team_id = ${q.teamId}`);
    }
    const rescored = await rescoreRequesterOpen(userId);
    return { ok: true, rescored };
  });

  // Public-API keys: minted here, shown once, act as their bound user.
  app.get('/api/admin/api-keys', async (req) => {
    requireAdmin(req);
    const { listApiKeys } = await import('../services/apiKeys.js');
    return listApiKeys();
  });

  app.post('/api/admin/api-keys', async (req) => {
    requireAdmin(req);
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      userId: z.number(),
    }).parse(req.body);
    const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, body.userId));
    if (!target || target.role === 'requester') {
      throw Object.assign(new Error('bind keys to a staff or readonly user'), { statusCode: 400 });
    }
    const { createApiKey } = await import('../services/apiKeys.js');
    return createApiKey(body.name, body.userId, req.userId);
  });

  app.delete('/api/admin/api-keys/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const { revokeApiKey } = await import('../services/apiKeys.js');
    return revokeApiKey(id);
  });

  // ServiceNow migration: upload a CSV export, get back the auto-detected
  // column mapping + sample rows (the dry run), then confirm to import.
  app.post('/api/admin/import/preview', async (req, reply) => {
    requireAdmin(req);
    const file = await (req as any).file();
    if (!file) return reply.status(400).send({ error: 'attach a CSV file' });
    const text = (await file.toBuffer()).toString('utf8');
    const { previewImport } = await import('../services/importService.js');
    return previewImport(text);
  });

  app.post('/api/admin/import/run', async (req) => {
    requireAdmin(req);
    const body = z.object({
      importId: z.string().max(40),
      mapping: z.record(z.string(), z.string().max(200)),
      runTriage: z.boolean().default(false),
    }).parse(req.body);
    const { runImport } = await import('../services/importService.js');
    return runImport(body.importId, body.mapping as any, { runTriage: body.runTriage });
  });

  // Addresses emailed whenever a ticket enters the queue (comma-separated).
  app.patch('/api/admin/queues/:id/notify', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      notifyEmails: z.string().trim().max(500).nullable(),
    }).parse(req.body);
    const emails = body.notifyEmails
      ? body.notifyEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
      : [];
    for (const e of emails) {
      if (!z.string().email().safeParse(e).success) {
        throw Object.assign(new Error(`not an email address: ${e}`), { statusCode: 400 });
      }
    }
    const [updated] = await db.update(teams)
      .set({ notifyEmails: emails.length ? emails.join(', ') : null })
      .where(eq(teams.id, id))
      .returning({ id: teams.id, notifyEmails: teams.notifyEmails });
    return updated;
  });

  // Toggle the approval gate: request tickets in gated categories wait for
  // the requester's manager before hitting a work queue.
  app.patch('/api/admin/categories/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ requiresApproval: z.boolean() }).parse(req.body);
    const [updated] = await db.update(categories)
      .set({ requiresApproval: body.requiresApproval })
      .where(eq(categories.id, id)).returning();
    return updated;
  });

  app.delete('/api/admin/templates/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    await db.delete(responseTemplates).where(eq(responseTemplates.id, id));
    return { ok: true };
  });

  app.put('/api/admin/score-weights', async (req) => {
    requireAdmin(req);
    const weights = z.object({
      priority: z.record(z.string(), z.number().min(0).max(200)),
      agePerBusinessDay: z.number().min(0).max(50),
      ageCap: z.number().min(0).max(200),
      vip: z.number().min(0).max(100),
      slaWarning: z.number().min(0).max(100),
      slaBreached: z.number().min(0).max(200),
      manualBoostRange: z.number().min(0).max(50),
      sentimentFrustrated: z.number().min(0).max(100).default(10),
      sentimentUrgent: z.number().min(0).max(100).default(5),
      allCapsPenalty: z.number().min(0).max(100).default(10),
    }).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'score_weights', value: weights, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: weights, updatedAt: new Date() } });
    invalidateScoreWeightsCache();
    const rescored = await rescoreOpenTickets();
    return { ok: true, rescored };
  });

  // Flag keywords: matches in subject/description boost the score and mark
  // the row. Saving rescores every open ticket immediately.
  app.put('/api/admin/score-keywords', async (req) => {
    requireAdmin(req);
    const keywords = z.array(z.object({
      term: z.string().trim().min(2).max(40),
      boost: z.number().min(-50).max(100),
    })).max(50).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'score_keywords', value: keywords, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: keywords, updatedAt: new Date() } });
    invalidateScoreWeightsCache();
    const rescored = await rescoreOpenTickets();
    return { ok: true, rescored };
  });

  // SOTO's environment knowledge — two tiers: the CORE quick-reference every
  // ticket pays for, and the EXPANDED profile used when routing confidence
  // lands under the auto-apply gate (and by suggest-fix). Plus the
  // show-its-work toggle. Edits reach the very next triage call.
  const aiEnvironmentState = async () => {
    const {
      getCoreEnvironmentProfile, getEnvironmentProfile,
      DEFAULT_CORE_ENVIRONMENT_PROFILE, DEFAULT_ENVIRONMENT_PROFILE,
    } = await import('../services/ai/provider.js');
    const { getShowWork } = await import('../services/ai/environment.js');
    return {
      core: {
        profile: getCoreEnvironmentProfile(),
        isDefault: getCoreEnvironmentProfile() === DEFAULT_CORE_ENVIRONMENT_PROFILE,
      },
      expanded: {
        profile: getEnvironmentProfile(),
        isDefault: getEnvironmentProfile() === DEFAULT_ENVIRONMENT_PROFILE,
      },
      showWork: await getShowWork(),
    };
  };

  app.get('/api/admin/ai-environment', async (req) => {
    requireAdmin(req);
    return aiEnvironmentState();
  });

  app.put('/api/admin/ai-environment', async (req) => {
    requireAdmin(req);
    // Only provided fields change; empty profile string = reset to default.
    const body = z.object({
      core: z.string().max(20_000).optional(),
      expanded: z.string().max(20_000).optional(),
      showWork: z.boolean().optional(),
    }).parse(req.body);
    const { saveEnvironmentProfile, setShowWork } = await import('../services/ai/environment.js');
    if (body.core !== undefined) await saveEnvironmentProfile('core', body.core);
    if (body.expanded !== undefined) await saveEnvironmentProfile('expanded', body.expanded);
    if (body.showWork !== undefined) await setShowWork(body.showWork);
    return { ok: true, ...(await aiEnvironmentState()) };
  });

  app.put('/api/admin/ai-thresholds', async (req) => {
    requireAdmin(req);
    const value = z.object({
      autoApply: z.number().min(0).max(1),
      suggest: z.number().min(0).max(1),
    }).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'ai_thresholds', value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
    return { ok: true };
  });

  app.post('/api/admin/statuses', async (req) => {
    requireAdmin(req);
    const body = z.object({
      name: z.string().trim().min(2).max(60),
      category: z.enum(['new', 'open', 'pending', 'resolved', 'closed']),
    }).parse(req.body);
    const [{ max }] = (await db.execute(sql`select coalesce(max(position),0) as max from statuses`)).rows as any[];
    const [created] = await db.insert(statuses)
      .values({ ...body, position: Number(max) + 1 })
      .returning();
    return created;
  });

  app.patch('/api/admin/statuses/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    const [updated] = await db.update(statuses).set({ name: body.name }).where(eq(statuses.id, id)).returning();
    return updated;
  });

  // Days a Resolved ticket waits before the sweep closes it; 0 disables.
  app.put('/api/admin/auto-close', async (req) => {
    requireAdmin(req);
    const value = z.object({ days: z.number().int().min(0).max(90) }).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'auto_close', value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
    return { ok: true };
  });

  // Stale-unassigned escalation: thresholds per priority; high-score tickets
  // assign by expertise, the rest round-robin.
  app.put('/api/admin/escalation', async (req) => {
    requireAdmin(req);
    const value = z.object({
      enabled: z.boolean(),
      minutesByPriority: z.record(z.string(), z.number().int().min(1).max(20160)),
      expertiseScoreThreshold: z.number().min(0).max(300),
    }).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'escalation', value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
    return { ok: true };
  });

  app.post('/api/admin/escalation/run', async (req) => {
    requireAdmin(req);
    const { escalationSweep } = await import('../services/escalation.js');
    return escalationSweep(() => {});
  });

  app.patch('/api/admin/sla-policies/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      firstResponseMinutes: z.number().min(5).max(50_000).nullable(),
      resolutionMinutes: z.number().min(5).max(100_000).nullable(),
    }).parse(req.body);
    // Applies to newly attached SLAs; running instances keep their targets.
    const [updated] = await db.update(slaPolicies).set(body).where(eq(slaPolicies.id, id)).returning();
    return updated;
  });

  app.post('/api/admin/routing-rules', async (req) => {
    requireAdmin(req);
    const body = z.object({
      name: z.string().trim().min(3).max(120),
      condition: z.object({
        field: z.enum(['subject', 'description', 'source', 'requester.department', 'requester.isVip']),
        op: z.enum(['contains', 'eq']),
        value: z.union([z.string(), z.boolean()]),
      }),
      actions: z.object({
        setQueue: z.string().optional(),
        minPriority: z.number().min(1).max(4).optional(),
        addTags: z.array(z.string()).optional(),
      }),
    }).parse(req.body);
    const [{ max }] = (await db.execute(sql`select coalesce(max(position),0) as max from routing_rules`)).rows as any[];
    const [created] = await db.insert(routingRules).values({
      name: body.name,
      position: Number(max) + 1,
      trigger: 'ticket_created',
      conditions: { any: [body.condition] },
      actions: body.actions,
    }).returning();
    return created;
  });

  app.patch('/api/admin/routing-rules/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const [updated] = await db.update(routingRules).set(body).where(eq(routingRules.id, id)).returning();
    return updated;
  });

  app.delete('/api/admin/routing-rules/:id', async (req) => {
    requireAdmin(req);
    const id = z.coerce.number().parse((req.params as any).id);
    await db.delete(routingRules).where(eq(routingRules.id, id));
    return { ok: true };
  });

  // --- agent expertise: manual grants + on-demand history sync ---

  app.post('/api/admin/agents/:id/skills', async (req) => {
    requireAdmin(req);
    const userId = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      name: z.string().trim().min(2).max(60),
      level: z.number().min(1).max(3).default(2),
    }).parse(req.body);
    let [skill] = await db.select().from(skills).where(eq(skills.name, body.name));
    if (!skill) [skill] = await db.insert(skills).values({ name: body.name }).returning();
    await db.insert(agentSkills)
      .values({ userId, skillId: skill!.id, level: body.level, source: 'manual' })
      .onConflictDoUpdate({
        target: [agentSkills.userId, agentSkills.skillId],
        set: { level: body.level, source: 'manual' }, // manual grant wins over auto
      });
    return { ok: true };
  });

  app.delete('/api/admin/agents/:id/skills/:skillId', async (req) => {
    requireAdmin(req);
    const userId = z.coerce.number().parse((req.params as any).id);
    const skillId = z.coerce.number().parse((req.params as any).skillId);
    await db.delete(agentSkills).where(sql`user_id = ${userId} and skill_id = ${skillId}`);
    return { ok: true };
  });

  app.post('/api/admin/skills/sync', async (req) => {
    requireAdmin(req);
    return deriveSkillsFromHistory();
  });
}
