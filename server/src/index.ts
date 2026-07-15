import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { eq, sql } from 'drizzle-orm';
import { env } from './config.js';
import { db, schema } from './db/index.js';
import { adminRoutes } from './routes/admin.js';
import { aiRoutes } from './routes/ai.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { kbRoutes } from './routes/kb.js';
import { mailRoutes } from './routes/mail.js';
import { metaRoutes } from './routes/meta.js';
import { notificationRoutes } from './routes/notifications.js';
import { approvalRoutes } from './routes/approvals.js';
import { chatRoutes } from './routes/chat.js';
import { attachmentRoutes } from './routes/attachments.js';
import { ticketRoutes } from './routes/tickets.js';
import { ensureKbEmbeddings } from './services/kb/kbService.js';
import { startSkillsSync } from './services/skills.js';
import { startSlaSweep } from './services/sla/slaService.js';
import { startAutoCloseSweep } from './services/autoClose.js';
import { startEscalationSweep } from './services/escalation.js';
import { startRecurringSweep } from './services/recurring.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
    userRole: 'admin' | 'agent' | 'requester' | 'readonly';
    userQueueVisibility: 'all' | 'own';
  }
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
const { default: multipart } = await import('@fastify/multipart');
await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

// Auth adapter. dev: the client says who it's acting as (x-user-id).
// entra: validate the Microsoft ID token and map it to a METS user
// (services/auth/entra.ts) — same request surface either way, so routes
// never know which mode is running. The role rides along on every request
// for RBAC (30s cache — roles effectively never change mid-session).
const roleCache = new Map<number, { role: FastifyRequest['userRole']; vis: FastifyRequest['userQueueVisibility']; at: number }>();
app.decorateRequest('userId', 0);
app.decorateRequest('userRole', 'requester');
app.decorateRequest('userQueueVisibility', 'all');
app.addHook('onRequest', async (req, reply) => {
  if (env.authProvider === 'entra') {
    if (req.url === '/api/health') return; // probes stay unauthenticated
    try {
      const { authenticateEntraRequest } = await import('./services/auth/entra.js');
      req.userId = await authenticateEntraRequest(req.headers.authorization);
    } catch {
      return reply.status(401).send({ error: 'sign in required' });
    }
  } else {
    const header = req.headers['x-user-id'];
    req.userId = header ? Number(header) : 1;
  }

  const hit = roleCache.get(req.userId);
  if (hit && Date.now() - hit.at < 30_000) {
    req.userRole = hit.role;
    req.userQueueVisibility = hit.vis;
    return;
  }
  const [u] = await db.select({ role: schema.users.role, vis: schema.users.queueVisibility }).from(schema.users)
    .where(eq(schema.users.id, req.userId));
  req.userRole = u?.role ?? 'requester';
  req.userQueueVisibility = (u?.vis as 'all' | 'own') ?? 'all';
  roleCache.set(req.userId, { role: req.userRole, vis: req.userQueueVisibility, at: Date.now() });
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
await app.register(notificationRoutes);
await app.register(approvalRoutes);
await app.register(chatRoutes);
await app.register(attachmentRoutes);

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
  startSlaSweep((msg) => app.log.info(msg));
  startAutoCloseSweep((msg) => app.log.info(msg));
  startEscalationSweep((msg) => app.log.info(msg));
  startRecurringSweep((msg) => app.log.info(msg));
  startSkillsSync((msg) => app.log.info(msg));
  // Embed KB articles in the background (first run downloads the model).
  ensureKbEmbeddings((msg) => app.log.info(msg)).catch((err) =>
    app.log.warn({ err }, 'kb embedding failed — search degrades to FTS-only'),
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
