import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchArticle, searchKb } from '../api';

export function KnowledgeBase() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: index } = useQuery({ queryKey: ['kb', debounced], queryFn: () => searchKb(debounced) });
  const { data: article } = useQuery({
    queryKey: ['kb-article', openId],
    queryFn: () => fetchArticle(openId!),
    enabled: openId != null,
  });

  return (
    <div className="kb">
      <div className="kb-list">
        <input
          className="kb-search"
          placeholder="Search the knowledge base… (hybrid: keywords + meaning)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpenId(null); }}
          autoFocus
        />
        {index?.results?.map((r) => (
          <button key={r.id} className={`kb-item ${openId === r.id ? 'active' : ''}`} onClick={() => setOpenId(r.id)}>
            <strong>{r.title}</strong>
            <span className="kb-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </button>
        ))}
        {index?.articles?.map((a) => (
          <button key={a.id} className={`kb-item ${openId === a.id ? 'active' : ''}`} onClick={() => setOpenId(a.id)}>
            <strong>{a.title}</strong>
          </button>
        ))}
        {index?.results?.length === 0 && <div className="empty">No articles match.</div>}
      </div>
      <div className="kb-reader">
        {article ? (
          <>
            <h2>{article.title}</h2>
            {article.bodyText.split(/\n\n+/).map((p, i) => <p key={i}>{p}</p>)}
          </>
        ) : (
          <div className="kb-placeholder">
            {index?.results ? 'Select a result to read it.' : 'Search, or pick an article from the list.'}
          </div>
        )}
      </div>
    </div>
  );
}
