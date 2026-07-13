import Fastify from 'fastify';
import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import { env } from './config.js';
import { db } from './db/index.js';
import { aiRoutes } from './routes/ai.js';
import { metaRoutes } from './routes/meta.js';
import { ticketRoutes } from './routes/tickets.js';
import { startSlaSweep } from './services/sla/slaService.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// Dev auth adapter: the client says who it's acting as. The Entra OIDC
// adapter replaces this hook with real session validation (config swap).
app.decorateRequest('userId', 0);
app.addHook('onRequest', async (req) => {
  const header = req.headers['x-user-id'];
  req.userId = header ? Number(header) : 1;
});

app.setErrorHandler((err: any, _req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.status(status).send({ error: err.message });
});

app.get('/api/health', async () => {
  const [row] = (await db.execute(sql`select now() as now`)).rows;
  return { ok: true, db: row?.now ?? null, adapters: {
    auth: env.authProvider,
    mail: env.mailProvider,
    ai: env.aiProvider,
    storage: env.storageProvider,
  } };
});

await app.register(metaRoutes);
await app.register(ticketRoutes);
await app.register(aiRoutes);

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
  startSlaSweep((msg) => app.log.info(msg));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
