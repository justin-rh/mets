import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actingUserId, decideApproval, draftReply, fetchBestFits, fetchMe,
  fetchMergeCandidates, fetchMeta, fetchSuggestions, fetchTicket,
  fetchTicketTemplates, fetchUsers, flagTicket, mergeTicket, openChat, patchTicket,
  postComment, watchTicket, type IdentifierCheck,
} from '../api';
import { copyToClipboard, fmtDateTime, initials } from '../format';
import { AttachmentStrip, usePasteAttach } from './Attachments';
import { SnoozeDialog } from './SnoozeDialog';
import { toast } from './Toasts';

export function TicketDetail({ ticketId }: { ticketId: number }) {
  const qc = useQueryClient();
  const { data: t } = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => fetchTicket(ticketId) });
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [reply, setReply] = useState('');
  const pasteAttach = usePasteAttach(ticketId);
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [showActivity, setShowActivity] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagKind, setFlagKind] = useState<'wrong_category' | 'needs_approval' | 'misrouted' | 'wrong_user'>('wrong_category');
  const [flagCategoryId, setFlagCategoryId] = useState('');
  const [flagUserId, setFlagUserId] = useState('');
  const [flagNote, setFlagNote] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeConflict, setMergeConflict] = useState<IdentifierCheck | null>(null);

  const copyLink = async (number: string) => {
    const url = `${window.location.origin}/?ticket=${number}`;
    const ok = await copyToClipboard(url);
    if (!ok) {
      window.prompt('Copy this link:', url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };
  const patch = useMutation({
    mutationFn: (changes: Parameters<typeof patchTicket>[1]) => patchTicket(ticketId, changes),
    onSuccess: (r: any) => {
      invalidate();
      if (r?.incidentResolved > 0) {
        qc.invalidateQueries({ queryKey: ['active-incidents'] });
        toast(`Incident resolved — ${r.incidentResolved} linked ticket${r.incidentResolved === 1 ? '' : 's'} closed & requesters notified`, 'success');
      }
    },
  });
  const comment = useMutation({
    mutationFn: () => postComment(ticketId, reply, visibility),
    onSuccess: (r: any) => {
      setReply('');
      invalidate();
      if (r?.broadcast > 0) {
        toast(`Update broadcast to ${r.broadcast} linked ticket${r.broadcast === 1 ? '' : 's'}`, 'success');
      }
    },
  });

  const { data: suggestions } = useQuery({
    queryKey: ['suggestions', ticketId],
    queryFn: () => fetchSuggestions(ticketId),
    staleTime: 300_000,
  });
  const { data: bestFits } = useQuery({
    queryKey: ['fit', ticketId],
    queryFn: () => fetchBestFits(ticketId),
    staleTime: 60_000,
  });
  const draft = useMutation({
    mutationFn: () => draftReply(ticketId),
    onSuccess: (d) => { setVisibility('public'); setReply(d.draft); },
  });
  const { data: templates } = useQuery({
    queryKey: ['templates', ticketId],
    queryFn: () => fetchTicketTemplates(ticketId),
    staleTime: 300_000,
  });
  const { data: me } = useQuery({ queryKey: ['me', actingUserId()], queryFn: fetchMe });
  const { data: mergeCands } = useQuery({
    queryKey: ['merge-candidates', ticketId],
    queryFn: () => fetchMergeCandidates(ticketId),
    enabled: mergeOpen,
  });
  const { data: directory } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 300_000,
    enabled: flagOpen,
  });
  const merge = useMutation({
    mutationFn: ({ force }: { force: boolean }) => mergeTicket(ticketId, mergeTargetId!, force),
    onSuccess: (r) => {
      if (r.requiresConfirmation) {
        setMergeConflict(r.check);
        return;
      }
      toast(`Merged into ${r.target} — requester notified, updates will fan out`, 'success');
      setMergeOpen(false);
      setMergeConflict(null);
      setMergeTargetId(null);
      invalidate();
    },
    onError: (e: any) => toast(e?.message ?? 'Merge failed', 'info'),
  });

  const flag = useMutation({
    mutationFn: () => flagTicket(ticketId, {
      kind: flagKind,
      categoryId: flagKind === 'wrong_category' && flagCategoryId ? Number(flagCategoryId) : undefined,
      userId: flagKind === 'wrong_user' && flagUserId ? Number(flagUserId) : undefined,
      note: flagNote.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast(r.message, 'success');
      setFlagOpen(false);
      setFlagNote('');
      setFlagCategoryId('');
      setFlagUserId('');
      invalidate();
    },
    onError: (e: any) => toast(e?.message ?? 'Could not flag', 'info'),
  });

  const watch = useMutation({
    mutationFn: ({ next, userId }: { next: boolean; userId?: number }) =>
      watchTicket(ticketId, next, userId),
    onSuccess: (r) => {
      if (r.added) {
        toast(r.alreadyWatching
          ? `${r.added} is already watching this ticket`
          : `${r.added} added as a watcher — they'll see it in their bell`, 'success');
      } else {
        toast(r.watching
          ? 'Watching — every update and reply lands in your bell'
          : 'Stopped watching', 'info');
      }
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: number; approve: boolean; note?: string }) =>
      decideApproval(id, approve, note),
    onSuccess: (_r, v) => {
      toast(v.approve ? `${t?.number} approved — routed to its queue` : `${t?.number} rejected`, v.approve ? 'success' : 'info');
      invalidate();
    },
    onError: (e: any) => toast(e?.message ?? 'Could not record decision', 'info'),
  });

  if (!t) return <div className="ticket-detail">Loading…</div>;
  const ai = (t as any).ai;

  return (
    <div className="ticket-detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail-main">
        {t.incident?.children.length > 0 && (
          <div className="incident-banner incident-parent">
            <span className="incident-title">
              ⚡ <strong>Suspected incident</strong> — {t.incident.children.length} linked ticket{t.incident.children.length === 1 ? '' : 's'}
            </span>
            <span className="incident-children">
              {t.incident.children.map((c) => (
                <button
                  key={c.id}
                  className="kb-chip"
                  title={`${c.subject} · ${c.status} — open in new tab`}
                  onClick={() => window.open(`/?ticket=${c.number}`, '_blank')}
                >
                  {c.number}
                </button>
              ))}
            </span>
            <span className="incident-hint">Public replies here broadcast to every linked requester.</span>
          </div>
        )}
        {t.incident?.parent && (
          <div className="incident-banner incident-child">
            ⚡ Part of{' '}
            <button
              className="kb-chip"
              title={t.incident.parent.subject}
              onClick={() => window.open(`/?ticket=${t.incident.parent!.number}`, '_blank')}
            >
              {t.incident.parent.number}
            </button>
            <span className="incident-hint">{t.incident.parent.subject.replace(/^(?:major|suspected) incident:\s*/i, '')}</span>
          </div>
        )}
        {t.incident?.mergedInto && (
          <div className="incident-banner incident-child">
            ⇄ Merged into{' '}
            <button
              className="kb-chip"
              title={t.incident.mergedInto.subject}
              onClick={() => window.open(`/?ticket=${t.incident.mergedInto!.number}`, '_blank')}
            >
              {t.incident.mergedInto.number}
            </button>
            <span className="incident-hint">updates there fan out to this requester</span>
          </div>
        )}
        {(t.incident?.duplicates?.length ?? 0) > 0 && (
          <div className="incident-banner incident-child">
            ⇄ Absorbed duplicates:{' '}
            {t.incident.duplicates.map((d) => (
              <button
                key={d.id}
                className="kb-chip"
                title={d.subject}
                onClick={() => window.open(`/?ticket=${d.number}`, '_blank')}
              >
                {d.number}
              </button>
            ))}
            <span className="incident-hint">public replies here reach their requesters too</span>
          </div>
        )}
        {t.approvals?.map((a) => (
          <div key={a.id} className={`approval-banner approval-${a.state}`}>
            {a.state === 'pending' ? (
              <>
                <span className="approval-text">
                  ⏳ <strong>Awaiting approval</strong> from {a.approverName}
                  {a.targetQueue ? <> — approving routes it to <strong>{a.targetQueue}</strong></> : null}
                </span>
                {(me?.role === 'admin' || me?.id === a.approverId) && (
                  <span className="approval-actions">
                    <button
                      className="btn accent"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: a.id, approve: true })}
                    >
                      Approve
                    </button>
                    <button
                      className="btn"
                      disabled={decide.isPending}
                      onClick={() => {
                        const note = window.prompt('Reason for rejecting (sent to the requester):') ?? undefined;
                        decide.mutate({ id: a.id, approve: false, note });
                      }}
                    >
                      Reject
                    </button>
                  </span>
                )}
              </>
            ) : (
              <span className="approval-text">
                {a.state === 'approved' ? '✓ Approved' : '✕ Rejected'} by {a.decidedByName ?? a.approverName}
                {a.decidedByName && a.decidedByName !== a.approverName ? ` (for ${a.approverName})` : ''}
                {a.decidedAt ? ` · ${fmtDateTime(a.decidedAt)}` : ''}
                {a.note ? ` — “${a.note}”` : ''}
              </span>
            )}
          </div>
        ))}
        {ai && (
          <div className="ai-panel">
            <span className="ai-badge">✨ AI</span>
            <span className="ai-summary">{ai.result.summary}</span>
            <span className="ai-meta">
              {ai.result.category} · {ai.result.sentiment !== 'neutral' ? `${ai.result.sentiment} · ` : ''}
              {ai.status.replace('_', ' ')}
            </span>
            {ai.result.reasoning && (
              <span className="ai-reasoning" title="Why the AI routed it this way">
                💡 {ai.result.reasoning}
              </span>
            )}
          </div>
        )}
        <p className="description">{t.description}</p>

        <AttachmentStrip ticketId={ticketId} attachments={t.attachments ?? []} canDelete={me?.role === 'admin'} />

        <div className="comments">
          {t.comments.map((c) => (
            <div key={c.id} className={`comment ${c.visibility}`}>
              <div className="comment-head">
                <strong>{c.author.name}</strong>
                {c.author.name === 'SOTO Bot' && (
                  <span className="auto-badge" title="SOTO: Sorts Out Tickets, Obviously">⚡ auto</span>
                )}
                {c.visibility === 'internal' && <span className="internal-badge">internal note</span>}
                <span className="comment-time">{fmtDateTime(c.createdAt)}</span>
              </div>
              <div>{c.bodyText}</div>
            </div>
          ))}
        </div>

        <div className="reply-box">
          <textarea
            placeholder={visibility === 'public' ? 'Reply to requester… (paste a screenshot to attach it)' : 'Add an internal note…'}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onPaste={pasteAttach}
          />
          <div className="reply-actions">
            <label className={`vis-toggle ${visibility}`}>
              <input
                type="checkbox"
                checked={visibility === 'internal'}
                onChange={(e) => setVisibility(e.target.checked ? 'internal' : 'public')}
              />
              Internal note
            </label>
            {templates && templates.length > 0 && (
              <select
                className="template-picker"
                value=""
                title="Insert a canned response — {{variables}} are filled in for this ticket"
                onChange={(e) => {
                  const tpl = templates.find((x) => x.id === Number(e.target.value));
                  if (!tpl) return;
                  setVisibility('public');
                  setReply((cur) => (cur.trim() ? `${cur}\n\n${tpl.body}` : tpl.body));
                }}
              >
                <option value="" disabled>📋 Template…</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
              </select>
            )}
            <button className="btn" disabled={draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? 'Drafting…' : '✨ Draft reply'}
            </button>
            <button className="btn primary" disabled={!reply.trim() || comment.isPending} onClick={() => comment.mutate()}>
              {visibility === 'public' ? 'Send reply' : 'Add note'}
            </button>
          </div>

          {(suggestions?.articles.length || suggestions?.similarTickets.length) ? (
            <div className="suggestions-panel">
              {suggestions.articles.length > 0 && (
                <div>
                  <span className="suggestions-title">Suggested articles</span>
                  {suggestions.articles.map((a) => (
                    <span key={a.id} className="kb-chip" title={a.snippet}>{a.title}</span>
                  ))}
                </div>
              )}
              {suggestions.similarTickets.length > 0 && (
                <div>
                  <span className="suggestions-title">Similar resolved</span>
                  {suggestions.similarTickets.map((s) => (
                    <span key={s.id} className="kb-chip" title={s.subject}>{s.number}</span>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <button className="activity-toggle" onClick={() => setShowActivity((v) => !v)}>
          {showActivity ? '▾' : '▸'} Activity ({t.events.length})
        </button>
        {showActivity && (
          <div className="activity">
            {t.events.map((e) => (
              <div key={e.id} className="event">
                <span className={`actor-chip actor-${e.actorType}`}>{e.actorType}</span>
                <span>
                  {e.actorName ?? 'System'} — {e.eventType.replace('_', ' ')}
                  {e.field ? `: ${e.oldValue ?? '—'} → ${e.newValue ?? '—'}` : ''}
                </span>
                <span className="comment-time">{fmtDateTime(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="detail-side">
        {bestFits && bestFits.length > 0 && (
          <div className="fit-row">
            <span className="suggestions-title">Suggested:</span>
            {bestFits.map((f) => (
              <button
                key={f.id}
                className={`avatar fit-avatar ${f.fit <= 0.5 ? 'fit-weak' : ''}`}
                title={`${f.name} — ${Math.round(f.fit * 100)}% fit${f.level ? ` · skill L${f.level}` : ''}${f.inQueue ? ' · in queue' : ''} — click to assign`}
                onClick={() =>
                  patch.mutate({ assigneeId: f.id }, {
                    onSuccess: () => toast(`${t.number} assigned to ${f.name}`, 'success', {
                      label: 'Undo',
                      onClick: () => patch.mutate({ assigneeId: t.assignee?.id ?? null }, { onSuccess: () => toast('Undone', 'info') }),
                    }),
                  })
                }
              >
                {initials(f.name)}
              </button>
            ))}
          </div>
        )}
        <div className="detail-actions">
          <button
            className="btn accent"
            disabled={patch.isPending}
            onClick={() => {
              const prev = t.assignee?.id ?? null;
              patch.mutate({ assigneeId: actingUserId() }, {
                onSuccess: () => toast(`${t.number} assigned to you`, 'success', {
                  label: 'Undo',
                  onClick: () => patch.mutate({ assigneeId: prev }, { onSuccess: () => toast('Undone', 'info') }),
                }),
              });
            }}
          >
            Assign to me
          </button>
          {t.snoozedUntil ? (
            <button className="btn" onClick={() => patch.mutate({ snooze: null })}>Unsnooze</button>
          ) : (
            <button className="btn" onClick={() => setSnoozeOpen(true)}>Snooze…</button>
          )}
          <button
            className="btn"
            title={`Copy a direct link to ${t.number}`}
            onClick={() => copyLink(t.number)}
          >
            {copied ? '✓ Copied' : '🔗 Link'}
          </button>
          <button
            className="btn"
            title="Discuss this ticket in agent chat"
            onClick={() => openChat({ prefill: `Can you take a look at ${t.number}? ` })}
          >
            💬 Chat
          </button>
          <button
            className={`btn ${flagOpen ? 'active' : ''}`}
            title="Flag this ticket: wrong category, needs approval, misrouted, or wrong user"
            onClick={() => setFlagOpen((v) => !v)}
          >
            ⚑ Flag
          </button>
          <button
            className={`btn ${t.watching ? 'watching' : ''}`}
            title={t.watchers?.length
              ? `Watching: ${t.watchers.map((w) => w.name).join(', ')}${t.watching ? ' — click to stop' : ' — click to join'}`
              : 'Get bell notifications for everything on this ticket'}
            disabled={watch.isPending}
            onClick={() => watch.mutate({ next: !t.watching })}
          >
            {t.watching ? '👁 Watching' : '👁 Watch'}
            {t.watcherCount > 0 && <span className="watch-count">{t.watcherCount}</span>}
          </button>
          <select
            className="watch-add"
            value=""
            title="Subscribe a colleague — they get bell updates and a heads-up that you added them"
            disabled={watch.isPending}
            onChange={(e) => {
              if (e.target.value) watch.mutate({ next: true, userId: Number(e.target.value) });
            }}
          >
            <option value="" disabled>➕ Add watcher…</option>
            {meta?.agents
              .filter((a) => !t.watchers?.some((w) => w.id === a.id))
              .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {!t.incident?.mergedInto && (
            <button
              className={`btn ${mergeOpen ? 'active' : ''}`}
              title="Merge this ticket into another as a duplicate"
              onClick={() => { setMergeOpen((v) => !v); setMergeConflict(null); }}
            >
              ⇄ Merge
            </button>
          )}
        </div>
        {mergeOpen && (
          <div className="merge-panel">
            <div className="merge-title">Merge this ticket into…</div>
            {(mergeCands ?? []).map((c) => (
              <label key={c.id} className="merge-option">
                <input
                  type="radio"
                  name={`merge-${ticketId}`}
                  checked={mergeTargetId === c.id}
                  onChange={() => { setMergeTargetId(c.id); setMergeConflict(null); }}
                />
                <span className="merge-option-main">
                  <span className="merge-option-head">
                    <span className="ticket-number">{c.number}</span> {c.subject}
                  </span>
                  <span className="merge-option-sub">
                    {c.requester}
                    {c.check.shared.length > 0 && (
                      <span className="merge-badge merge-badge-ok" title="Both tickets cite these exact identifiers">
                        ✓ shares {c.check.shared.slice(0, 2).join(', ')}
                      </span>
                    )}
                    {c.check.conflict && (
                      <span className="merge-badge merge-badge-warn" title="These tickets reference different part/order numbers">
                        ⚠ different part #s
                      </span>
                    )}
                  </span>
                </span>
              </label>
            ))}
            {mergeCands && mergeCands.length === 0 && (
              <div className="merge-empty">No similar open tickets found.</div>
            )}
            {mergeConflict && (
              <div className="merge-conflict">
                <strong>⚠ Hold on — these cite different identifiers.</strong>
                <span>This ticket: {mergeConflict.onlyInSource.join(', ') || '—'}</span>
                <span>Target: {mergeConflict.onlyInTarget.join(', ') || '—'}</span>
                <span>Part and order numbers that look alike are usually different things. Merge only if you're sure it's the same issue.</span>
              </div>
            )}
            <div className="flag-actions">
              <button className="btn" onClick={() => { setMergeOpen(false); setMergeConflict(null); }}>Cancel</button>
              {mergeConflict ? (
                <button
                  className="btn primary"
                  disabled={merge.isPending}
                  onClick={() => merge.mutate({ force: true })}
                >
                  Merge anyway
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={mergeTargetId == null || merge.isPending}
                  onClick={() => merge.mutate({ force: false })}
                >
                  {merge.isPending ? 'Merging…' : 'Merge as duplicate'}
                </button>
              )}
            </div>
          </div>
        )}
        {flagOpen && (
          <div className="flag-panel">
            <label className="flag-option">
              <input
                type="radio"
                name={`flag-${ticketId}`}
                checked={flagKind === 'wrong_category'}
                onChange={() => setFlagKind('wrong_category')}
              />
              <span>
                Wrong category
                <em>corrections teach the AI</em>
              </span>
            </label>
            {flagKind === 'wrong_category' && (
              <select
                className="flag-category"
                value={flagCategoryId}
                onChange={(e) => setFlagCategoryId(e.target.value)}
              >
                <option value="">Not sure — just flag it</option>
                {meta?.categories?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <label className="flag-option">
              <input
                type="radio"
                name={`flag-${ticketId}`}
                checked={flagKind === 'needs_approval'}
                onChange={() => setFlagKind('needs_approval')}
              />
              <span>
                Needs manager approval
                <em>parks it until the requester's manager signs off</em>
              </span>
            </label>
            <label className="flag-option">
              <input
                type="radio"
                name={`flag-${ticketId}`}
                checked={flagKind === 'misrouted'}
                onChange={() => setFlagKind('misrouted')}
              />
              <span>
                Not a fit for this queue
                <em>unassigns and sends it back to intake for re-triage</em>
              </span>
            </label>
            <label className="flag-option">
              <input
                type="radio"
                name={`flag-${ticketId}`}
                checked={flagKind === 'wrong_user'}
                onChange={() => setFlagKind('wrong_user')}
              />
              <span>
                Wrong user
                <em>really for someone else — swaps the requester, teaches the AI</em>
              </span>
            </label>
            {flagKind === 'wrong_user' && (
              <select
                className="flag-category"
                value={flagUserId}
                onChange={(e) => setFlagUserId(e.target.value)}
              >
                <option value="">Not sure — just flag it</option>
                {(directory ?? [])
                  .filter((u) => u.id !== t.requester.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.department ?? u.location ?? '—'})</option>
                  ))}
              </select>
            )}
            <textarea
              className="flag-note"
              rows={2}
              placeholder="Why? (optional — saved as an internal note)"
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
            />
            <div className="flag-actions">
              <button className="btn" onClick={() => setFlagOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={flag.isPending} onClick={() => flag.mutate()}>
                {flag.isPending ? 'Flagging…' : 'Flag ticket'}
              </button>
            </div>
          </div>
        )}
        <dl className="detail-meta">
          <dt>Status</dt>
          <dd>
            <select value={t.status.id} onChange={(e) => patch.mutate({ statusId: Number(e.target.value) })}>
              {meta?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </dd>
          <dt>Priority</dt>
          <dd>
            <select value={t.priority} onChange={(e) => patch.mutate({ priority: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
            </select>
          </dd>
          <dt>Queue</dt>
          <dd>
            <select
              value={t.queue.id}
              onChange={(e) => {
                const qid = Number(e.target.value);
                const name = meta?.queues.find((q) => q.id === qid)?.name ?? 'queue';
                patch.mutate({ queueId: qid }, { onSuccess: () => toast(`${t.number} moved to ${name}`, 'success') });
              }}
            >
              {meta?.queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </dd>
          <dt>Assignee</dt>
          <dd>{t.assignee?.name ?? 'Unassigned'}</dd>
          <dt>Requester</dt>
          <dd>
            {t.requester.name}
            {t.submittedBy && (
              <span className="on-behalf" title={`Submitted on their behalf by ${t.submittedBy.name}`}>*</span>
            )}
            {t.requester.isVip ? ' ★' : ''} · {t.requester.department ?? '—'}
            {t.submittedBy && (
              <span className="on-behalf-note">submitted by {t.submittedBy.name}</span>
            )}
          </dd>
          <dt>Category</dt>
          <dd>{t.category ?? '—'}</dd>
          {t.tags.length > 0 && (
            <>
              <dt>Tags</dt>
              <dd className="detail-tags">
                {t.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
              </dd>
            </>
          )}
          {(((t as any).customFields?.flaggedKeywords?.length ?? 0) > 0
            || (t as any).customFields?.sentimentFlag
            || (t as any).customFields?.shouting) && (
            <>
              <dt>Flags</dt>
              <dd className="detail-tags">
                {((t as any).customFields?.flaggedKeywords ?? []).map((f: { term: string; boost: number }) => (
                  <span key={f.term} className="tag flag-tag" title={`Keyword match boosts score by ${f.boost}`}>
                    🚩 {f.term} +{f.boost}
                  </span>
                ))}
                {(t as any).customFields?.sentimentFlag && (
                  <span className="tag flag-tag" title="From AI triage — boosts the score">
                    {(t as any).customFields.sentimentFlag === 'frustrated' ? '😤 frustrated' : '⚡ urgent tone'}
                  </span>
                )}
                {(t as any).customFields?.shouting && (
                  <span className="tag shout-tag" title="Mostly capital letters — score docked. Inside voice, please.">
                    🔇 all caps
                  </span>
                )}
              </dd>
            </>
          )}
          <dt>Source</dt>
          <dd>{t.source}</dd>
          <dt>Created</dt>
          <dd>{fmtDateTime(t.createdAt)}</dd>
          {t.snoozedUntil && (
            <>
              <dt>Snoozed</dt>
              <dd>until {fmtDateTime(t.snoozedUntil)} — {t.snoozeReason}</dd>
            </>
          )}
          <dt>Score</dt>
          <dd>{t.score} {t.manualBoost !== 0 ? `(boost ${t.manualBoost > 0 ? '+' : ''}${t.manualBoost})` : ''}</dd>
          {t.csatRating != null && (
            <>
              <dt>CSAT</dt>
              <dd title={t.csatComment ?? undefined}>
                <span className="csat-stars">{'★'.repeat(t.csatRating)}{'☆'.repeat(5 - t.csatRating)}</span>
                {t.csatComment && <span className="csat-quote"> “{t.csatComment}”</span>}
              </dd>
            </>
          )}
        </dl>
      </div>

      {snoozeOpen && (
        <SnoozeDialog
          onCancel={() => setSnoozeOpen(false)}
          onConfirm={(until, reason) => {
            setSnoozeOpen(false);
            patch.mutate({ snooze: { until, reason } });
          }}
        />
      )}
    </div>
  );
}
