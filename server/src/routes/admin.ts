import type { FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { invalidateScoreWeightsCache, recomputeScore } from '../services/scoring.js';
import { deriveSkillsFromHistory } from '../services/skills.js';

const { appConfig, statuses, slaPolicies, routingRules, users, tickets, skills, agentSkills, responseTemplates, categories } = schema;

/** All admin mutations require the admin role — the RBAC requirement, live. */
async function requireAdmin(userId: number) {
  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (me?.role !== 'admin') {
    throw Object.assign(new Error('admin role required'), { statusCode: 403 });
  }
}

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
    await requireAdmin(req.userId);
    const configRows = await db.select().from(appConfig);
    const byKey = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
    return {
      scoreWeights: byKey['score_weights'] ?? null,
      aiThresholds: byKey['ai_thresholds'] ?? { autoApply: 0.8, suggest: 0.35 },
      businessHours: byKey['business_hours'] ?? null,
      statuses: await db.select().from(statuses).orderBy(asc(statuses.position)),
      skills: await db.select().from(skills).orderBy(asc(skills.name)),
      slaPolicies: await db.select().from(slaPolicies).orderBy(asc(slaPolicies.id)),
      routingRules: await db.select().from(routingRules).orderBy(asc(routingRules.position)),
      templates: await db.select().from(responseTemplates).orderBy(asc(responseTemplates.name)),
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
    await requireAdmin(req.userId);
    const body = templateBody.parse(req.body);
    const [created] = await db.insert(responseTemplates).values(body).returning();
    return created;
  });

  app.patch('/api/admin/templates/:id', async (req) => {
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = templateBody.partial().parse(req.body);
    const [updated] = await db.update(responseTemplates)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(responseTemplates.id, id)).returning();
    return updated;
  });

  // Toggle the approval gate: request tickets in gated categories wait for
  // the requester's manager before hitting a work queue.
  app.patch('/api/admin/categories/:id', async (req) => {
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ requiresApproval: z.boolean() }).parse(req.body);
    const [updated] = await db.update(categories)
      .set({ requiresApproval: body.requiresApproval })
      .where(eq(categories.id, id)).returning();
    return updated;
  });

  app.delete('/api/admin/templates/:id', async (req) => {
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    await db.delete(responseTemplates).where(eq(responseTemplates.id, id));
    return { ok: true };
  });

  app.put('/api/admin/score-weights', async (req) => {
    await requireAdmin(req.userId);
    const weights = z.object({
      priority: z.record(z.string(), z.number().min(0).max(200)),
      agePerBusinessDay: z.number().min(0).max(50),
      ageCap: z.number().min(0).max(200),
      vip: z.number().min(0).max(100),
      slaWarning: z.number().min(0).max(100),
      slaBreached: z.number().min(0).max(200),
      manualBoostRange: z.number().min(0).max(50),
    }).parse(req.body);
    await db.insert(appConfig)
      .values({ key: 'score_weights', value: weights, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: weights, updatedAt: new Date() } });
    invalidateScoreWeightsCache();
    const rescored = await rescoreOpenTickets();
    return { ok: true, rescored };
  });

  app.put('/api/admin/ai-thresholds', async (req) => {
    await requireAdmin(req.userId);
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
    await requireAdmin(req.userId);
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
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    const [updated] = await db.update(statuses).set({ name: body.name }).where(eq(statuses.id, id)).returning();
    return updated;
  });

  app.patch('/api/admin/sla-policies/:id', async (req) => {
    await requireAdmin(req.userId);
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
    await requireAdmin(req.userId);
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
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const [updated] = await db.update(routingRules).set(body).where(eq(routingRules.id, id)).returning();
    return updated;
  });

  app.delete('/api/admin/routing-rules/:id', async (req) => {
    await requireAdmin(req.userId);
    const id = z.coerce.number().parse((req.params as any).id);
    await db.delete(routingRules).where(eq(routingRules.id, id));
    return { ok: true };
  });

  // --- agent expertise: manual grants + on-demand history sync ---

  app.post('/api/admin/agents/:id/skills', async (req) => {
    await requireAdmin(req.userId);
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
    await requireAdmin(req.userId);
    const userId = z.coerce.number().parse((req.params as any).id);
    const skillId = z.coerce.number().parse((req.params as any).skillId);
    await db.delete(agentSkills).where(sql`user_id = ${userId} and skill_id = ${skillId}`);
    return { ok: true };
  });

  app.post('/api/admin/skills/sync', async (req) => {
    await requireAdmin(req.userId);
    return deriveSkillsFromHistory();
  });
}
