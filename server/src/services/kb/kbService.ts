import { eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { embed } from './embeddings.js';

const { kbArticles, kbChunks, tickets } = schema;

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
 * reciprocal-rank fusion (k=60).
 */
export async function hybridSearch(query: string, limit = 5): Promise<KbHit[]> {
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
    where a.status = 'published'
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
      where a.status = 'published'
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

/** Resolved tickets similar to the given text — often more useful than KB. */
export async function similarResolvedTickets(query: string, excludeId: number, limit = 3) {
  const rows = await db.execute(sql`
    select t.id, t.number, t.subject, t.resolved_at,
           ts_rank(to_tsvector('english', t.subject || ' ' || t.description),
                   websearch_to_tsquery('english', ${query})) as rank
    from tickets t
    where t.resolved_at is not null
      and t.id <> ${excludeId}
      and to_tsvector('english', t.subject || ' ' || t.description)
          @@ websearch_to_tsquery('english', ${query})
    order by rank desc
    limit ${limit}
  `);
  return rows.rows;
}

/** KB + similar-ticket suggestions for a ticket. */
export async function suggestionsForTicket(ticketId: number) {
  const [t] = await db.select({ subject: tickets.subject, description: tickets.description })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return { articles: [], similarTickets: [] };
  const query = `${t.subject} ${t.description.slice(0, 300)}`;
  const [articles, similar] = await Promise.all([
    hybridSearch(query, 3),
    similarResolvedTickets(t.subject, ticketId, 3),
  ]);
  return { articles, similarTickets: similar };
}
