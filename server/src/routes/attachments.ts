import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import {
  ALLOWED_EXTENSIONS, MAX_FILE_BYTES, deleteFile, extensionOf,
  inlineContentType, readFile, saveFile,
} from '../services/storage/localStorage.js';

const { attachments, tickets, users } = schema;

/** Staff, or the person the ticket is for / who filed it. */
async function canTouchTicket(req: FastifyRequest, ticketId: number): Promise<boolean> {
  if (req.userRole === 'admin' || req.userRole === 'agent') return true;
  const [t] = await db.select({ requesterId: tickets.requesterId, submittedById: tickets.submittedById })
    .from(tickets).where(eq(tickets.id, ticketId));
  return !!t && (t.requesterId === req.userId || t.submittedById === req.userId);
}

export async function attachmentRoutes(app: FastifyInstance) {
  // Upload one or more files to a ticket (multipart). Requesters can attach
  // screenshots to their own tickets; agents to any.
  app.post('/api/tickets/:id/attachments', async (req, reply) => {
    const ticketId = z.coerce.number().parse((req.params as any).id);
    const [t] = await db.select({ id: tickets.id, number: tickets.number })
      .from(tickets).where(eq(tickets.id, ticketId));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });
    if (!(await canTouchTicket(req, ticketId))) {
      return reply.status(403).send({ error: 'not your ticket' });
    }

    // Pasted screenshots arrive with generic names (the browser calls them
    // all image.png; the client's paste counter resets per page load, so
    // "pasted-screenshot-1.png" repeats across tickets). Rename them to the
    // ticket: T-1000042-screenshot-2.png. Real filenames pass through.
    const existing = await db.select({ id: attachments.id })
      .from(attachments).where(eq(attachments.ticketId, ticketId));
    let screenshotN = existing.length;
    const GENERIC = /^(pasted-screenshot(-\d+)?|image|screenshot( \(\d+\))?|clipboard(-\d+)?)\.(png|jpe?g|gif|webp)$/i;

    const saved = [];
    for await (const part of req.files()) {
      const ext = extensionOf(part.filename ?? '');
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return reply.status(400).send({
          error: `file type ${ext || '(none)'} not allowed — images, pdf, office docs, logs, zip`,
        });
      }
      const filename = GENERIC.test(part.filename ?? '')
        ? `${t.number}-screenshot-${++screenshotN}${ext}`
        : part.filename!;
      const buffer = await part.toBuffer(); // throws if over the size limit
      const { storageKey, sha256 } = await saveFile(buffer, filename);
      const [row] = await db.insert(attachments).values({
        ticketId,
        filename: filename.slice(0, 200),
        contentType: part.mimetype || 'application/octet-stream',
        size: buffer.length,
        storageKey, sha256,
        uploadedBy: req.userId,
      }).returning();
      saved.push({ id: row!.id, filename: row!.filename, size: row!.size, contentType: row!.contentType });
      await db.insert(schema.ticketEvents).values({
        ticketId, actorId: req.userId, actorType: 'user', eventType: 'attachment_added',
        field: 'attachment', newValue: row!.filename,
      });
    }
    if (saved.length === 0) return reply.status(400).send({ error: 'no files in request' });
    return { ok: true, attachments: saved };
  });

  // Stream a file. Access mirrors the ticket: staff or the requester side.
  app.get('/api/attachments/:id', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!a) return reply.status(404).send({ error: 'attachment not found' });
    if (!(await canTouchTicket(req, a.ticketId))) {
      return reply.status(403).send({ error: 'not your ticket' });
    }
    // Attachment ids are reused across reseeds, so the browser must
    // revalidate every time — the content hash makes that a cheap 304.
    const etag = `"${a.sha256}"`;
    reply
      .header('etag', etag)
      .header('cache-control', 'private, no-cache')
      .header('x-content-type-options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }
    const bytes = await readFile(a.storageKey);
    const safeName = a.filename.replace(/[^\w.\- ()]/g, '_');
    reply
      .header('content-type', inlineContentType(a.contentType) ? a.contentType : 'application/octet-stream')
      .header('content-disposition',
        `${inlineContentType(a.contentType) ? 'inline' : 'attachment'}; filename="${safeName}"`);
    return reply.send(bytes);
  });

  // Uploader or admin can remove a mistaken upload.
  app.delete('/api/attachments/:id', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!a) return reply.status(404).send({ error: 'attachment not found' });
    if (a.uploadedBy !== req.userId && req.userRole !== 'admin') {
      return reply.status(403).send({ error: 'only the uploader or an admin can delete' });
    }
    await db.delete(attachments).where(eq(attachments.id, id));
    await deleteFile(a.storageKey);
    await db.insert(schema.ticketEvents).values({
      ticketId: a.ticketId, actorId: req.userId, actorType: 'user',
      eventType: 'attachment_removed', field: 'attachment', newValue: a.filename,
    });
    return { ok: true };
  });
}

/** Attachment list for the ticket detail. */
export async function attachmentsForTicket(ticketId: number) {
  const uploader = users;
  return db
    .select({
      id: attachments.id, filename: attachments.filename,
      contentType: attachments.contentType, size: attachments.size,
      createdAt: attachments.createdAt, uploadedBy: uploader.name,
    })
    .from(attachments)
    .leftJoin(uploader, eq(uploader.id, attachments.uploadedBy))
    .where(and(eq(attachments.ticketId, ticketId)))
    .orderBy(attachments.id);
}
