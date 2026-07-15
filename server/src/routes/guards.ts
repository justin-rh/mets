import type { FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * The role matrix, in one place:
 *
 * - admin      everything, including config and role management
 * - agent      works tickets (all ticket mutations, AI review, chat);
 *              a per-team 'lead' membership adds team powers on top —
 *              today: toggling teammates' availability
 * - readonly   staff READ surfaces only (dashboards, decision log, fit,
 *              mailboxes) — never mutations. SOTO Bot lives here.
 * - requester  the self-service portal; ticket list/detail scoped to
 *              their own tickets in the routes themselves
 */

/** Mutating staff surface: agents and admins. */
export function requireStaff(req: FastifyRequest) {
  if (req.userRole !== 'admin' && req.userRole !== 'agent') {
    throw Object.assign(new Error('agents only'), { statusCode: 403 });
  }
}

/** Read-only staff surface: agents, admins, and readonly viewers. */
export function requireStaffRead(req: FastifyRequest) {
  if (req.userRole !== 'admin' && req.userRole !== 'agent' && req.userRole !== 'readonly') {
    throw Object.assign(new Error('staff only'), { statusCode: 403 });
  }
}

/** Admin-only surface (config, roles, memberships). Uses the cached role. */
export function requireAdmin(req: FastifyRequest) {
  if (req.userRole !== 'admin') {
    throw Object.assign(new Error('admin role required'), { statusCode: 403 });
  }
}

/** Is this user a lead of the given team? (team_memberships.role = 'lead') */
export async function isTeamLead(userId: number, teamId: number): Promise<boolean> {
  const [row] = await db.select({ role: schema.teamMemberships.role })
    .from(schema.teamMemberships)
    .where(and(
      eq(schema.teamMemberships.userId, userId),
      eq(schema.teamMemberships.teamId, teamId),
    ));
  return row?.role === 'lead';
}

/** Does this user lead ANY team the target user belongs to? */
export async function leadsTeamOf(userId: number, targetUserId: number): Promise<boolean> {
  const rows = await db.execute(sql`
    select 1 from team_memberships lead
    join team_memberships member on member.team_id = lead.team_id
    where lead.user_id = ${userId} and lead.role = 'lead'
      and member.user_id = ${targetUserId}
    limit 1
  `);
  return rows.rows.length > 0;
}
