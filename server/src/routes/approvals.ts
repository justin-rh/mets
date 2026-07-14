import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { decideApproval } from '../services/approvalService.js';

const { approvals, tickets, users, teams } = schema;

export async function approvalRoutes(app: FastifyInstance) {
  // Pending approvals where the caller is the approver (admins see all).
  app.get('/api/approvals', async (req) => {
    const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.userId));
    const rows = await db
      .select({
        id: approvals.id, state: approvals.state, note: approvals.note,
        createdAt: approvals.createdAt, decidedAt: approvals.decidedAt,
        approverId: approvals.approverId, approverName: users.name,
        ticketId: tickets.id, number: tickets.number, subject: tickets.subject,
        targetQueue: teams.name,
      })
      .from(approvals)
      .innerJoin(tickets, eq(tickets.id, approvals.ticketId))
      .innerJoin(users, eq(users.id, approvals.approverId))
      .leftJoin(teams, eq(teams.id, approvals.targetQueueId))
      .where(eq(approvals.state, 'pending'))
      .orderBy(desc(approvals.createdAt));
    return me?.role === 'admin' ? rows : rows.filter((r) => r.approverId === req.userId);
  });

  app.post('/api/approvals/:id/decision', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      approve: z.boolean(),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body);
    return decideApproval(id, req.userId, body.approve, body.note);
  });
}
