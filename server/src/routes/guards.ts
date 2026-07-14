import type { FastifyRequest } from 'fastify';

/** RBAC: agent/admin-only surface — requesters get their own portal. */
export function requireStaff(req: FastifyRequest) {
  if (req.userRole !== 'admin' && req.userRole !== 'agent') {
    throw Object.assign(new Error('agents only'), { statusCode: 403 });
  }
}
