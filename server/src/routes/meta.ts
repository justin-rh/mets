import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';

const { users, teams, statuses, tags, teamMemberships, agentSkills, skills, categories } = schema;

/** Board bootstrap: statuses, queues with open counts, agents with load + skills, tags. */
export async function metaRoutes(app: FastifyInstance) {
  app.get('/api/meta', async () => {
    const statusRows = await db.select().from(statuses).orderBy(statuses.position);

    const queueRows = await db
      .select({
        id: teams.id, name: teams.name, slug: teams.slug,
        assignmentPolicy: teams.assignmentPolicy,
        openCount: sql<number>`(
          select count(*) from tickets t join statuses s on s.id = t.status_id
          where t.queue_id = teams.id and s.category not in ('resolved','closed')
        )`.mapWith(Number),
      })
      .from(teams)
      .orderBy(teams.id);

    const agentRows = await db
      .select({
        id: users.id, name: users.name,
        openCount: sql<number>`(
          select count(*) from tickets t join statuses s on s.id = t.status_id
          where t.assignee_id = users.id and s.category not in ('resolved','closed')
        )`.mapWith(Number),
        maxOpen: users.maxOpenAssignments,
        isAvailable: users.isAvailable,
      })
      .from(users)
      .where(sql`${users.role} in ('agent','admin') and ${users.isActive}`)
      .orderBy(users.name);

    const memberships = await db
      .select({ userId: teamMemberships.userId, teamId: teamMemberships.teamId, role: teamMemberships.role })
      .from(teamMemberships);
    const skillRows = await db
      .select({
        userId: agentSkills.userId, skillId: agentSkills.skillId,
        skill: skills.name, level: agentSkills.level, source: agentSkills.source,
      })
      .from(agentSkills)
      .innerJoin(skills, eq(skills.id, agentSkills.skillId));

    const agents = agentRows.map((a) => ({
      ...a,
      teamIds: memberships.filter((m) => m.userId === a.id).map((m) => m.teamId),
      leadOf: memberships.filter((m) => m.userId === a.id && m.role === 'lead').map((m) => m.teamId),
      skills: skillRows
        .filter((s) => s.userId === a.id)
        .sort((x, y) => y.level - x.level)
        .map((s) => ({ id: s.skillId, name: s.skill, level: s.level, source: s.source })),
    }));

    const tagRows = await db.select().from(tags).orderBy(tags.name);
    const categoryRows = await db.select({ id: categories.id, name: categories.name })
      .from(categories).orderBy(categories.name);

    return { statuses: statusRows, queues: queueRows, agents, tags: tagRows, categories: categoryRows };
  });

  // Directory for the on-behalf-of picker and the dev user switcher:
  // every active person (bot excluded).
  app.get('/api/users', async () => {
    return db
      .select({
        id: users.id, name: users.name, role: users.role,
        department: users.department, location: users.location,
      })
      .from(users)
      .where(sql`${users.isActive} and ${users.role} != 'readonly'`)
      .orderBy(users.name);
  });

  app.get('/api/me', async (req) => {
    const [me] = await db.select().from(users).where(eq(users.id, req.userId));
    return me ?? null;
  });

  // Out-of-office toggle: yourself, or anyone if you're an admin. OOO agents
  // are excluded from every assignment engine (auto, expertise, best-fit).
  app.patch('/api/users/:id/availability', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({ isAvailable: z.boolean() }).parse(req.body);
    if (id !== req.userId) {
      const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.userId));
      if (me?.role !== 'admin') return reply.status(403).send({ error: 'admins only' });
    }
    const [updated] = await db.update(users)
      .set({ isAvailable: body.isAvailable })
      .where(eq(users.id, id))
      .returning({ id: users.id, isAvailable: users.isAvailable });
    return updated;
  });
}
