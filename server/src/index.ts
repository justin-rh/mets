import Fastify from 'fastify';
import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import { env } from './config.js';
import { db } from './db/index.js';
import { adminRoutes } from './routes/admin.js';
import { aiRoutes } from './routes/ai.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { kbRoutes } from './routes/kb.js';
import { mailRoutes } from './routes/mail.js';
import { metaRoutes } from './routes/meta.js';
import { ticketRoutes } from './routes/tickets.js';
import { ensureKbEmbeddings } from './services/kb/kbService.js';
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
await app.register(kbRoutes);
await app.register(dashboardRoutes);
await app.register(mailRoutes);
await app.register(adminRoutes);

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
  startSlaSweep((msg) => app.log.info(msg));
  // Embed KB articles in the background (first run downloads the model).
  ensureKbEmbeddings((msg) => app.log.info(msg)).catch((err) =>
    app.log.warn({ err }, 'kb embedding failed — search degrades to FTS-only'),
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
