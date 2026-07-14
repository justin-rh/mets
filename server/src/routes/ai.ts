import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  acceptEnrichment, batchTriage, correctEnrichment, dismissEnrichment,
  listDecisions, listTriageSuggestions,
} from '../services/ai/enrichment.js';
import { requireStaff } from './guards.js';

export async function aiRoutes(app: FastifyInstance) {
  // Natural-language queue search: plain English in, structured list
  // filters out. The client applies them to the normal tickets query.
  app.post('/api/search/parse', async (req) => {
    requireStaff(req);
    const { query } = z.object({ query: z.string().trim().min(3).max(300) }).parse(req.body);
    const { db, schema } = await import('../db/index.js');
    const { getAIProvider } = await import('../services/ai/provider.js');

    const [queues, categories, tags] = await Promise.all([
      db.select({ slug: schema.teams.slug, name: schema.teams.name }).from(schema.teams),
      db.select({ name: schema.categories.name }).from(schema.categories),
      db.select({ name: schema.tags.name }).from(schema.tags),
    ]);
    const outcome = await getAIProvider().parseSearch(query, {
      queues,
      categories: categories.map((c) => c.name),
      tags: tags.map((t) => t.name),
    });
    await db.insert(schema.aiUsage).values({
      feature: 'search', model: outcome.model,
      inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
    });

    // Resolve names to ids server-side so the client applies filters directly.
    const r = outcome.result;
    const queue = r.queueSlug
      ? queues.find((q) => q.slug === r.queueSlug) ?? null : null;
    const [queueRow] = queue
      ? await db.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.slug, queue.slug))
      : [undefined];
    const [categoryRow] = r.categoryName
      ? await db.select({ id: schema.categories.id }).from(schema.categories)
          .where(eq(schema.categories.name, r.categoryName))
      : [undefined];

    return {
      interpretation: r.interpretation,
      confidence: r.confidence,
      filters: {
        view: r.status === 'closed' ? 'closed' : r.status === 'any' ? 'all' : 'open',
        queueId: queueRow?.id,
        categoryId: categoryRow?.id,
        tags: r.tags.length ? r.tags.join(',') : undefined,
        olderThanDays: r.olderThanDays ?? undefined,
        newerThanDays: r.newerThanDays ?? undefined,
        priorityAtMost: r.priorityAtMost ?? undefined,
        unassigned: r.unassignedOnly ? ('1' as const) : undefined,
        search: r.textSearch ?? undefined,
      },
    };
  });
  // Run AI triage over untriaged open tickets (or specific ones). Synchronous
  // by design for the demo — the button shows a spinner while Claude works.
  app.post('/api/ai/triage', async (req) => {
    requireStaff(req);
    const body = z.object({
      limit: z.number().min(1).max(25).default(10),
      ticketIds: z.array(z.number()).optional(),
    }).parse(req.body ?? {});
    return batchTriage(body.limit, body.ticketIds);
  });

  app.get('/api/ai/triage', async (req) => { requireStaff(req); return listTriageSuggestions(); });

  app.post('/api/ai/enrichments/:id/accept', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      category: z.boolean().default(true),
      queue: z.boolean().default(true),
      priority: z.boolean().default(true),
    }).parse(req.body ?? {});
    return acceptEnrichment(id, req.userId, body);
  });

  app.post('/api/ai/enrichments/:id/dismiss', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    return dismissEnrichment(id);
  });

  // The AI decision log: how tickets were routed and what agents did about it.
  app.get('/api/ai/decisions', async (req) => { requireStaff(req); return listDecisions(); });

  // Flag & correct: the labeled feedback that future triage prompts learn from.
  app.post('/api/ai/enrichments/:id/correct', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const fix = z.object({
      categoryId: z.number().optional(),
      queueId: z.number().optional(),
      priority: z.number().min(1).max(4).optional(),
    }).refine((f) => f.categoryId || f.queueId || f.priority, { message: 'at least one correction required' })
      .parse(req.body);
    return correctEnrichment(id, req.userId, fix);
  });
}
