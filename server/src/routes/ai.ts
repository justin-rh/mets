import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  acceptEnrichment, batchTriage, correctEnrichment, dismissEnrichment,
  listDecisions, listTriageSuggestions,
} from '../services/ai/enrichment.js';
import { requireStaff } from './guards.js';

export async function aiRoutes(app: FastifyInstance) {
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
