import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { acceptEnrichment, batchTriage, dismissEnrichment, listTriageSuggestions } from '../services/ai/enrichment.js';

export async function aiRoutes(app: FastifyInstance) {
  // Run AI triage over untriaged open tickets (or specific ones). Synchronous
  // by design for the demo — the button shows a spinner while Claude works.
  app.post('/api/ai/triage', async (req) => {
    const body = z.object({
      limit: z.number().min(1).max(25).default(10),
      ticketIds: z.array(z.number()).optional(),
    }).parse(req.body ?? {});
    return batchTriage(body.limit, body.ticketIds);
  });

  app.get('/api/ai/triage', async () => listTriageSuggestions());

  app.post('/api/ai/enrichments/:id/accept', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      category: z.boolean().default(true),
      queue: z.boolean().default(true),
      priority: z.boolean().default(true),
    }).parse(req.body ?? {});
    return acceptEnrichment(id, req.userId, body);
  });

  app.post('/api/ai/enrichments/:id/dismiss', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    return dismissEnrichment(id);
  });
}
