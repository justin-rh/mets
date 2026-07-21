import { eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { embed } from './embeddings.js';

const { kbArticles, kbChunks, tickets, ticketEmbeddings } = schema;

/**
 * Chunk + embed any published article that has no chunks yet. Articles here
 * are short; paragraph-level chunks approximate the heading-aware ~400-token
 * chunking the design calls for at production scale.
 */
export async function ensureKbEmbeddings(log?: (m: string) => void) {
  const missing = await db
    .select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.bodyText })
    .from(kbArticles)
    .leftJoin(kbChunks, eq(kbChunks.articleId, kbArticles.id))
    .where(isNull(kbChunks.id));
  const unique = [...new Map(missing.map((a) => [a.id, a])).values()];
  if (unique.length === 0) return 0;

  for (const article of unique) {
    const paragraphs = article.body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const texts = paragraphs.map((p) => `${article.title}\n${p}`);
    const vectors = await embed(texts);
    await db.insert(kbChunks).values(paragraphs.map((content, i) => ({
      articleId: article.id, chunkIndex: i, content, embedding: vectors[i]!,
    })));
  }
  log?.(`kb: embedded ${unique.length} articles`);
  return unique.length;
}

export type KbHit = {
  id: number; title: string; snippet: string; score: number;
};

/**
 * Long queries (a whole ticket's text) must NOT require every term — build
 * an any-term tsquery so ts_rank rewards the best partial match. Plain
 * alphanumeric lexemes only, so the tsquery input is injection-safe.
 */
function orTsQuery(query: string): string {
  const words = [...new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3),
  )].slice(0, 24);
  return words.join(' | ');
}

/**
 * Hybrid search: Postgres FTS and pgvector cosine ranks merged with
 * reciprocal-rank fusion (k=60). excludeInternal drops internal-only
 * articles — the requester-facing surfaces (portal KB access, the
 * deflection bot) must never see them.
 */
export async function hybridSearch(
  query: string,
  limit = 5,
  opts: { excludeInternal?: boolean } = {},
): Promise<KbHit[]> {
  const internalClause = opts.excludeInternal ? sql`and not a.internal_only` : sql``;
  const orQuery = orTsQuery(query);
  const fts = orQuery.length === 0 ? { rows: [] } : await db.execute(sql`
    select a.id, a.title,
           ts_headline('english', a.body_text, to_tsquery('english', ${orQuery}),
                       'MaxWords=28, MinWords=12') as snippet,
           row_number() over (order by ts_rank(
             setweight(to_tsvector('english', a.title), 'A') ||
             setweight(to_tsvector('english', a.body_text), 'B'),
             to_tsquery('english', ${orQuery})) desc) as rank
    from kb_articles a
    where a.status = 'published' ${internalClause}
      and (setweight(to_tsvector('english', a.title), 'A') ||
           setweight(to_tsvector('english', a.body_text), 'B'))
          @@ to_tsquery('english', ${orQuery})
    limit 12
  `);

  let vecRows: { id: number; title: string; snippet: string; rank: number }[] = [];
  try {
    const [qv] = await embed([query]);
    const vec = await db.execute(sql`
      select a.id, a.title, c.content as snippet,
             row_number() over (order by min_dist) as rank
      from (
        select article_id, min(embedding <=> ${JSON.stringify(qv)}::vector) as min_dist
        from kb_chunks
        group by article_id
        order by min_dist
        limit 12
      ) v
      join kb_articles a on a.id = v.article_id
      join lateral (
        select content from kb_chunks
        where article_id = v.article_id
        order by embedding <=> ${JSON.stringify(qv)}::vector
        limit 1
      ) c on true
      where a.status = 'published' ${internalClause}
      order by v.min_dist
    `);
    vecRows = vec.rows as any;
  } catch {
    // embeddings unavailable (model still downloading) — FTS-only is fine
  }

  const K = 60;
  const fused = new Map<number, KbHit>();
  const add = (rows: any[], weight = 1) => {
    for (const r of rows) {
      const id = Number(r.id);
      const existing = fused.get(id);
      const score = weight / (K + Number(r.rank));
      if (existing) existing.score += score;
      else fused.set(id, { id, title: r.title, snippet: String(r.snippet ?? '').slice(0, 220), score });
    }
  };
  add(fts.rows as any[]);
  add(vecRows);

  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Semantic memory over resolved tickets: one vector per ticket, same local
 * MiniLM model as the KB chunks. Backfills anything resolved without an
 * embedding — runs at boot in the background; embedTicket() keeps it fresh
 * as tickets resolve.
 */
export async function ensureTicketEmbeddings(log?: (m: string) => void) {
  const missing = (await db.execute(sql`
    select t.id, t.subject, t.description
    from tickets t
    left join ticket_embeddings e on e.ticket_id = t.id
    where t.resolved_at is not null and e.ticket_id is null
    order by t.resolved_at desc
    limit 2000
  `)).rows as { id: number; subject: string; description: string }[];
  if (missing.length === 0) return 0;

  const BATCH = 32;
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH);
    const vectors = await embed(slice.map((t) => `${t.subject}\n${String(t.description).slice(0, 1000)}`));
    await db.insert(ticketEmbeddings)
      .values(slice.map((t, j) => ({ ticketId: Number(t.id), embedding: vectors[j]! })))
      .onConflictDoNothing();
  }
  log?.(`tickets: embedded ${missing.length} resolved tickets for similar-ticket grounding`);
  return missing.length;
}

/** Embed (or re-embed) one ticket — fired when a ticket resolves. */
export async function embedTicket(ticketId: number) {
  const [t] = await db.select({ subject: tickets.subject, description: tickets.description })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return;
  const [v] = await embed([`${t.subject}\n${t.description.slice(0, 1000)}`]);
  await db.insert(ticketEmbeddings)
    .values({ ticketId, embedding: v!, updatedAt: new Date() })
    .onConflictDoUpdate({ target: ticketEmbeddings.ticketId, set: { embedding: v!, updatedAt: new Date() } });
}

export type SimilarTicket = {
  id: number; number: string; subject: string; resolved_at: string;
  /** Cosine similarity when the vector leg found it; absent for FTS-only hits. */
  similarity?: number;
};

/**
 * Resolved tickets similar to the given text — often more useful than KB.
 * Hybrid like the KB search: any-term FTS (exact words) + vector cosine
 * (meaning — catches "labels print crooked" ≈ "Zebra printing offset")
 * fused with reciprocal-rank fusion.
 */
export async function similarResolvedTickets(query: string, excludeId: number, limit = 3): Promise<SimilarTicket[]> {
  const orQuery = orTsQuery(query);
  const fts = orQuery.length === 0 ? { rows: [] } : await db.execute(sql`
    select t.id, t.number, t.subject, t.resolved_at,
           row_number() over (order by ts_rank(
             setweight(to_tsvector('english', t.subject), 'A') ||
             setweight(to_tsvector('english', t.description), 'B'),
             to_tsquery('english', ${orQuery})) desc) as rank
    from tickets t
    where t.resolved_at is not null
      and t.id <> ${excludeId}
      and (setweight(to_tsvector('english', t.subject), 'A') ||
           setweight(to_tsvector('english', t.description), 'B'))
          @@ to_tsquery('english', ${orQuery})
    limit 10
  `);

  let vecRows: any[] = [];
  try {
    const [qv] = await embed([query.slice(0, 1000)]);
    const vec = await db.execute(sql`
      select t.id, t.number, t.subject, t.resolved_at,
             1 - (e.embedding <=> ${JSON.stringify(qv)}::vector) as similarity,
             row_number() over (order by e.embedding <=> ${JSON.stringify(qv)}::vector) as rank
      from ticket_embeddings e
      join tickets t on t.id = e.ticket_id
      where t.resolved_at is not null and t.id <> ${excludeId}
      order by e.embedding <=> ${JSON.stringify(qv)}::vector
      limit 10
    `);
    vecRows = vec.rows as any[];
  } catch {
    // embeddings unavailable (model still downloading) — FTS-only is fine
  }

  const K = 60;
  const fused = new Map<number, SimilarTicket & { score: number }>();
  const add = (rows: any[]) => {
    for (const r of rows) {
      const id = Number(r.id);
      const score = 1 / (K + Number(r.rank));
      const existing = fused.get(id);
      if (existing) {
        existing.score += score;
        existing.similarity ??= r.similarity != null ? Number(r.similarity) : undefined;
      } else {
        fused.set(id, {
          id, number: r.number, subject: r.subject, resolved_at: r.resolved_at,
          similarity: r.similarity != null ? Number(r.similarity) : undefined,
          score,
        });
      }
    }
  };
  add(fts.rows as any[]);
  add(vecRows);

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

/** KB + similar-ticket suggestions for a ticket. */
export async function suggestionsForTicket(ticketId: number) {
  const [t] = await db.select({ subject: tickets.subject, description: tickets.description })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return { articles: [], similarTickets: [] };
  const query = `${t.subject} ${t.description.slice(0, 300)}`;
  const [articles, similar] = await Promise.all([
    hybridSearch(query, 3),
    similarResolvedTickets(query, ticketId, 3),
  ]);
  return { articles, similarTickets: similar };
}
