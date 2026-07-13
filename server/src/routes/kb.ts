import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { hybridSearch, suggestionsForTicket } from '../services/kb/kbService.js';
import { getAIProvider } from '../services/ai/provider.js';

const { kbArticles, kbChunks, tickets, ticketComments, users, aiUsage } = schema;

export async function kbRoutes(app: FastifyInstance) {
  app.get('/api/kb', async (req) => {
    const q = z.object({ q: z.string().trim().max(300).optional() }).parse(req.query);
    if (q.q) return { results: await hybridSearch(q.q, 8), articles: null };
    const all = await db
      .select({ id: kbArticles.id, title: kbArticles.title, updatedAt: kbArticles.updatedAt })
      .from(kbArticles)
      .where(eq(kbArticles.status, 'published'))
      .orderBy(asc(kbArticles.title));
    return { results: null, articles: all };
  });

  app.get('/api/kb/:id', async (req, reply) => {
    const id = z.coerce.number().parse((req.params as any).id);
    const [article] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
    if (!article) return reply.status(404).send({ error: 'article not found' });
    return article;
  });

  // KB + similar-resolved-ticket suggestions for the expanded ticket view.
  app.get('/api/tickets/:id/suggestions', async (req) => {
    const id = z.coerce.number().parse((req.params as any).id);
    return suggestionsForTicket(id);
  });

  // Draft a grounded reply with Claude; the agent edits before sending.
  app.post('/api/tickets/:id/draft-reply', async (req, reply) => {
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
