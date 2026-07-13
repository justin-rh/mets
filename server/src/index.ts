import Fastify from 'fastify';
import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import { env } from './config.js';
import { db } from './db/index.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/api/health', async () => {
  const [row] = (await db.execute(sql`select now() as now`)).rows;
  return { ok: true, db: row?.now ?? null, adapters: {
    auth: env.authProvider,
    mail: env.mailProvider,
    ai: env.aiProvider,
    storage: env.storageProvider,
  } };
});

try {
  await app.listen({ port: env.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
