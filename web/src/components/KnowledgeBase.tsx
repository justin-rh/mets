import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actingUserId, createArticle, discardArticle, fetchArticle, fetchMe,
  publishArticle, searchKb, updateArticle,
} from '../api';
import { Md } from './Md';
import { toast } from './Toasts';

type Editor = { id: number | null; title: string; body: string };

export function KnowledgeBase() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: index } = useQuery({ queryKey: ['kb', debounced], queryFn: () => searchKb(debounced) });
  const { data: me } = useQuery({ queryKey: ['me', actingUserId()], queryFn: fetchMe });
  const staff = me?.role === 'admin' || me?.role === 'agent';
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
  const save = useMutation({
    mutationFn: (opts: { publish: boolean }) =>
      editor!.id != null
        ? updateArticle(editor!.id, { title: editor!.title.trim(), bodyText: editor!.body.trim() })
        : createArticle({ title: editor!.title.trim(), bodyText: editor!.body.trim(), publish: opts.publish }),
    onSuccess: (a) => {
      toast(
        editor!.id != null ? 'Article updated — search reindexed'
          : a.status === 'published' ? `Published “${a.title}” — searchable now`
          : 'Draft saved — publish it when it’s ready',
        'success',
      );
      setEditor(null);
      setOpenId(a.id);
      invalidate();
    },
  });
  const canSave = editor != null && editor.title.trim().length >= 3 && editor.body.trim().length >= 20;

  return (
    <div className="kb">
      <div className="kb-list">
        <div className="kb-list-head">
          <input
            className="kb-search"
            placeholder="Search the knowledge base… (hybrid: keywords + meaning)"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpenId(null); }}
            autoFocus
          />
          {staff && (
            <button
              className="btn"
              title="Write a new article"
              onClick={() => { setOpenId(null); setEditor({ id: null, title: '', body: '' }); }}
            >
              ＋ New
            </button>
          )}
        </div>
        {(index?.drafts?.length ?? 0) > 0 && (
          <div className="kb-drafts">
            <div className="kb-drafts-title">✨ AI drafts awaiting review ({index!.drafts.length})</div>
            {index!.drafts.map((d) => (
              <button
                key={d.id}
                className={`kb-item kb-item-draft ${openId === d.id ? 'active' : ''}`}
                onClick={() => { setEditor(null); setOpenId(d.id); }}
              >
                <strong>{d.title}</strong>
                <span className="kb-snippet">drafted from {d.sourceTicket ?? 'a resolved ticket'}</span>
              </button>
            ))}
          </div>
        )}
        {index?.results?.map((r) => (
          <button key={r.id} className={`kb-item ${openId === r.id ? 'active' : ''}`} onClick={() => { setEditor(null); setOpenId(r.id); }}>
            <strong>{r.title}</strong>
            <span className="kb-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </button>
        ))}
        {index?.articles?.map((a) => (
          <button key={a.id} className={`kb-item ${openId === a.id ? 'active' : ''}`} onClick={() => { setEditor(null); setOpenId(a.id); }}>
            <strong>{a.title}</strong>
          </button>
        ))}
        {index?.results?.length === 0 && <div className="empty">No articles match.</div>}
      </div>
      <div className="kb-reader">
        {editor ? (
          <div className="kb-editor">
            <h2>{editor.id != null ? 'Edit article' : 'New article'}</h2>
            <input
              placeholder="Article title"
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              autoFocus
            />
            <textarea
              placeholder="Write the article… step-by-step fixes read best."
              value={editor.body}
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
              rows={18}
            />
            <div className="kb-editor-actions">
              <span className="kb-editor-hint">Markdown supported</span>
              <button className="btn" onClick={() => setEditor(null)}>Cancel</button>
              {editor.id == null && (
                <button className="btn" disabled={!canSave || save.isPending} onClick={() => save.mutate({ publish: false })}>
                  Save as draft
                </button>
              )}
              <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate({ publish: true })}>
                {save.isPending ? 'Saving…' : editor.id != null ? 'Save' : 'Publish'}
              </button>
            </div>
          </div>
        ) : article ? (
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
            <div className="kb-article-head">
              <h2>{article.title}</h2>
              {staff && (
                <button
                  className="btn ghost"
                  title="Edit this article"
                  onClick={() => setEditor({ id: article.id, title: article.title, body: article.bodyText })}
                >
                  ✏️ Edit
                </button>
              )}
            </div>
            <Md>{article.bodyText}</Md>
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
