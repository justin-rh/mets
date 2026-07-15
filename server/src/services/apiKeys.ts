import { createHash, randomBytes } from 'node:crypto';
import { desc, eq, isNull, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { apiKeys, users } = schema;

/**
 * Public-API keys. The secret is `mets_` + 32 hex chars, shown exactly once
 * at creation; only its sha256 is stored. A key acts AS its bound user, so
 * the whole RBAC stack (role, queue visibility) applies unchanged — bind a
 * readonly user for read-only integrations.
 */

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

// Verified keys cache for a minute so hot integrations don't hit the DB
// per request; revocation therefore lands within 60s.
const cache = new Map<string, { userId: number; at: number }>();
const CACHE_TTL = 60_000;

export async function createApiKey(name: string, userId: number, createdBy: number) {
  const secret = `mets_${randomBytes(16).toString('hex')}`;
  const [row] = await db.insert(apiKeys).values({
    name, userId, createdBy,
    keyHash: hash(secret),
    prefix: secret.slice(0, 12) + '…',
  }).returning();
  return { secret, key: row! };
}

export async function listApiKeys() {
  return db
    .select({
      id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix,
      userId: apiKeys.userId, userName: users.name, userRole: users.role,
      createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(id: number) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  cache.clear(); // revocation beats the cache
  return { ok: true };
}

/** The user this key acts as, or null for unknown/revoked keys. */
export async function verifyApiKey(secret: string): Promise<number | null> {
  const h = hash(secret);
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.userId;

  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, h), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  cache.set(h, { userId: row.userId, at: Date.now() });
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return row.userId;
}
