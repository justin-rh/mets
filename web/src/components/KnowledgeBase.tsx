import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { discardArticle, fetchArticle, publishArticle, searchKb } from '../api';
import { toast } from './Toasts';

export function KnowledgeBase() {
  const qc = useQueryClient();
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['kb'] });
    qc.invalidateQueries({ queryKey: ['kb-article'] });
  };
  const publish = useMutation({
    mutationFn: (id: number) => publishArticle(id),
    onSuccess: (a) => { toast(`Published “${a.title}” — searchable now`, 'success'); invalidate(); },
  });
  const discard = useMutation({
    mutationFn: (id: number) => discardArticle(id),
    onSuccess: () => { setOpenId(null); invalidate(); },
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
        {(index?.drafts?.length ?? 0) > 0 && (
          <div className="kb-drafts">
            <div className="kb-drafts-title">✨ AI drafts awaiting review ({index!.drafts.length})</div>
            {index!.drafts.map((d) => (
              <button
                key={d.id}
                className={`kb-item kb-item-draft ${openId === d.id ? 'active' : ''}`}
                onClick={() => setOpenId(d.id)}
              >
                <strong>{d.title}</strong>
                <span className="kb-snippet">drafted from {d.sourceTicket ?? 'a resolved ticket'}</span>
              </button>
            ))}
          </div>
        )}
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
            {article.status === 'draft' && (
              <div className="kb-draft-bar">
                <span className="kb-draft-badge">✨ AI draft</span>
                {article.sourceTicket && (
                  <button
                    className="kb-chip"
                    title="Open the source ticket in a new tab"
                    onClick={() => window.open(`/?ticket=${article.sourceTicket}`, '_blank')}
                  >
                    from {article.sourceTicket}
                  </button>
                )}
                <span className="kb-draft-spacer" />
                <button className="btn" disabled={discard.isPending} onClick={() => discard.mutate(article.id)}>
                  Discard
                </button>
                <button className="btn primary" disabled={publish.isPending} onClick={() => publish.mutate(article.id)}>
                  {publish.isPending ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            )}
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
