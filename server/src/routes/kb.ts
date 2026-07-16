import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { ensureKbEmbeddings, hybridSearch, suggestionsForTicket } from '../services/kb/kbService.js';
import { getAIProvider } from '../services/ai/provider.js';
import { requireStaff } from './guards.js';

const { kbArticles, kbChunks, tickets, ticketComments, users, aiUsage } = schema;

export async function kbRoutes(app: FastifyInstance) {
  app.get('/api/kb', async (req) => {
    const q = z.object({ q: z.string().trim().max(300).optional() }).parse(req.query);
    // AI-drafted articles awaiting review — staff only; search never sees them.
    const drafts = req.userRole === 'admin' || req.userRole === 'agent'
      ? await db
          .select({
            id: kbArticles.id, title: kbArticles.title, createdAt: kbArticles.createdAt,
            sourceTicket: tickets.number,
          })
          .from(kbArticles)
          .leftJoin(tickets, eq(tickets.id, kbArticles.sourceTicketId))
          .where(eq(kbArticles.status, 'draft'))
          .orderBy(asc(kbArticles.createdAt))
      : [];
    if (q.q) return { results: await hybridSearch(q.q, 8), articles: null, drafts };
    const all = await db
      .select({ id: kbArticles.id, title: kbArticles.title, updatedAt: kbArticles.updatedAt })
      .from(kbArticles)
      .where(eq(kbArticles.status, 'published'))
      .orderBy(asc(kbArticles.title));
    return { results: null, articles: all, drafts };
  });

  // On-demand KB search seeded from a ticket's text — the agent-side
  // "Search KB" button. Staff only (readonly viewers included).
  app.get('/api/tickets/:id/kb-search', async (req, reply) => {
    const { requireStaffRead } = await import('./guards.js');
    requireStaffRead(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [t] = await db.select({ subject: tickets.subject, description: tickets.description })
      .from(tickets).where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });
    return hybridSearch(`${t.subject} ${t.description.slice(0, 300)}`, 5);
  });

  app.get('/api/kb/:id', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [article] = await db
      .select({
        id: kbArticles.id, title: kbArticles.title, bodyText: kbArticles.bodyText,
        status: kbArticles.status, updatedAt: kbArticles.updatedAt,
        sourceTicket: tickets.number,
      })
      .from(kbArticles)
      .leftJoin(tickets, eq(tickets.id, kbArticles.sourceTicketId))
      .where(eq(kbArticles.id, id));
    if (!article) return reply.status(404).send({ error: 'article not found' });
    if (article.status !== 'published') requireStaff(req);
    return article;
  });

  // Manual authoring — agents add articles directly from the KB tab.
  app.post('/api/kb', async (req) => {
    requireStaff(req);
    const body = z.object({
      title: z.string().trim().min(3).max(200),
      bodyText: z.string().trim().min(20).max(20_000),
      publish: z.boolean().default(true),
    }).parse(req.body);
    const [article] = await db.insert(kbArticles).values({
      title: body.title, bodyText: body.bodyText,
      status: body.publish ? 'published' : 'draft', authorId: req.userId,
    }).returning();
    if (body.publish) await ensureKbEmbeddings();
    return article;
  });

  // Edit title/body of any article (drafts included — fix before publishing).
  // Chunks are rebuilt so search and deflection see the new text immediately.
  app.patch('/api/kb/:id', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const body = z.object({
      title: z.string().trim().min(3).max(200).optional(),
      bodyText: z.string().trim().min(20).max(20_000).optional(),
    }).parse(req.body);
    const [updated] = await db.update(kbArticles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(kbArticles.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'article not found' });
    await db.delete(kbChunks).where(eq(kbChunks.articleId, id));
    await ensureKbEmbeddings();
    return updated;
  });

  // Turn a ticket into a KB draft on demand — the agent decided this thread
  // is worth documenting, so the automatic gates step aside.
  app.post('/api/tickets/:id/draft-article', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [t] = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });
    const { maybeDraftArticle } = await import('../services/kbDrafts.js');
    const article = await maybeDraftArticle(id, { force: true });
    if (!article) return reply.status(422).send({ error: 'SOTO could not write an article from this ticket — add resolution notes to the thread and try again.' });
    return { id: article.id, title: article.title, status: article.status };
  });

  // Review actions for AI drafts. Publishing embeds the article so hybrid
  // search picks it up immediately.
  app.post('/api/kb/:id/publish', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [updated] = await db.update(kbArticles)
      .set({ status: 'published', updatedAt: new Date() })
      .where(and(eq(kbArticles.id, id), eq(kbArticles.status, 'draft')))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'no such draft' });
    const { ensureKbEmbeddings } = await import('../services/kb/kbService.js');
    await ensureKbEmbeddings();
    return updated;
  });

  app.post('/api/kb/:id/discard', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [updated] = await db.update(kbArticles)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(kbArticles.id, id), eq(kbArticles.status, 'draft')))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'no such draft' });
    return { ok: true };
  });

  // KB + similar-resolved-ticket suggestions for the expanded ticket view.
  app.get('/api/tickets/:id/suggestions', async (req) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    return suggestionsForTicket(id);
  });

  // Draft a grounded reply with Claude; the agent edits before sending.
  app.post('/api/tickets/:id/draft-reply', async (req, reply) => {
    requireStaff(req);
    const id = z.coerce.number().parse((req.params as any).id);
    const [t] = await db
      .select({
        subject: tickets.subject, description: tickets.description,
        requesterName: users.name,
      })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.requesterId))
      .where(eq(tickets.id, id));
    if (!t) return reply.status(404).send({ error: 'ticket not found' });

    const author = schema.users;
    const comments = await db
      .select({
        body: ticketComments.bodyText, visibility: ticketComments.visibility,
        authorId: ticketComments.authorId,
      })
      .from(ticketComments)
      .where(eq(ticketComments.ticketId, id))
      .orderBy(asc(ticketComments.createdAt));
    const authorRows = await db.select({ id: author.id, name: author.name }).from(author);
    const nameOf = new Map(authorRows.map((a) => [a.id, a.name]));

    const { articles } = await suggestionsForTicket(id);
    const chunks = articles.length
      ? await db.select({ articleId: kbChunks.articleId, content: kbChunks.content })
          .from(kbChunks)
      : [];
    const articleInputs = articles.map((a) => ({
      title: a.title,
      content: chunks.filter((c) => c.articleId === a.id).map((c) => c.content).join('\n').slice(0, 1500),
    }));

    const outcome = await getAIProvider().draftReply({
      subject: t.subject,
      description: t.description,
      requesterName: t.requesterName,
      thread: comments.slice(-8).map((c) => ({
        author: nameOf.get(c.authorId) ?? 'Unknown', visibility: c.visibility, body: c.body.slice(0, 800),
      })),
      articles: articleInputs,
    });

    await db.insert(aiUsage).values({
      feature: 'draft_reply', model: outcome.model, ticketId: id,
      inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
    });

    return { draft: outcome.draft, groundedIn: articles.map((a) => a.title) };
  });
}
