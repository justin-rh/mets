// Entra ID (Azure AD) auth adapter — DORMANT until AUTH_PROVIDER=entra plus
// ENTRA_TENANT_ID / ENTRA_CLIENT_ID land in .env (needs an app registration;
// see docs/SSO.md for the activation checklist).
//
// Design: Entra proves WHO you are (ID token, Authorization Code + PKCE in
// the SPA); the users table decides WHAT you can do. Roles never come from
// the token, so every RBAC rule in METS works unchanged.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { env } from '../../config.js';

const { users } = schema;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keySet() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${env.entraTenantId}/discovery/v2.0/keys`),
    );
  }
  return jwks;
}

export type EntraClaims = {
  oid: string;          // stable per-user object id in the tenant
  email: string;
  name: string;
};

/** Validate a Microsoft ID token: signature, issuer, audience, expiry. */
export async function verifyEntraToken(token: string): Promise<EntraClaims> {
  const { payload } = await jwtVerify(token, keySet(), {
    issuer: `https://login.microsoftonline.com/${env.entraTenantId}/v2.0`,
    audience: env.entraClientId,
  });
  const p = payload as JWTPayload & { oid?: string; preferred_username?: string; email?: string; name?: string };
  const email = (p.email ?? p.preferred_username ?? '').toLowerCase();
  if (!p.oid || !email) throw new Error('token missing oid/email claims');
  return { oid: p.oid, email, name: p.name ?? email };
}

// oid -> userId, so repeat requests skip the DB lookup.
const userCache = new Map<string, { userId: number; at: number }>();

/**
 * Map validated claims to a METS user: entra_id match first, then email
 * (stamping entra_id on first SSO login), else provision a requester —
 * anyone who can sign into the tenant can file tickets; agent/admin roles
 * are granted in METS, never inferred from Entra.
 */
export async function resolveEntraUser(claims: EntraClaims): Promise<number> {
  const hit = userCache.get(claims.oid);
  if (hit && Date.now() - hit.at < 60_000) return hit.userId;

  let [user] = await db.select({ id: users.id }).from(users)
    .where(eq(users.entraId, claims.oid));
  if (!user) {
    const [byEmail] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, claims.email));
    if (byEmail) {
      await db.update(users).set({ entraId: claims.oid }).where(eq(users.id, byEmail.id));
      user = byEmail;
    }
  }
  if (!user) {
    [user] = await db.insert(users).values({
      name: claims.name, email: claims.email, entraId: claims.oid, role: 'requester',
    }).returning({ id: users.id });
  }
  userCache.set(claims.oid, { userId: user!.id, at: Date.now() });
  return user!.id;
}

/** Bearer header -> METS user id. Throws on anything invalid. */
export async function authenticateEntraRequest(authorization: string | undefined): Promise<number> {
  if (!authorization?.startsWith('Bearer ')) throw new Error('missing bearer token');
  const claims = await verifyEntraToken(authorization.slice(7));
  return resolveEntraUser(claims);
}
