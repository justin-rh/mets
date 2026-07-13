import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actingUserId, fetchMeta, fetchTicket, patchTicket, postComment } from '../api';
import { fmtDateTime } from '../format';
import { SnoozeDialog } from './SnoozeDialog';

export function TicketDetail({ ticketId }: { ticketId: number }) {
  const qc = useQueryClient();
  const { data: t } = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => fetchTicket(ticketId) });
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [reply, setReply] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [showActivity, setShowActivity] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };
  const patch = useMutation({
    mutationFn: (changes: Parameters<typeof patchTicket>[1]) => patchTicket(ticketId, changes),
    onSuccess: invalidate,
  });
  const comment = useMutation({
    mutationFn: () => postComment(ticketId, reply, visibility),
    onSuccess: () => { setReply(''); invalidate(); },
  });

  if (!t) return <div className="ticket-detail">Loading…</div>;

  return (
    <div className="ticket-detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail-main">
        <p className="description">{t.description}</p>

        <div className="comments">
          {t.comments.map((c) => (
            <div key={c.id} className={`comment ${c.visibility}`}>
              <div className="comment-head">
                <strong>{c.author.name}</strong>
                {c.visibility === 'internal' && <span className="internal-badge">internal note</span>}
                <span className="comment-time">{fmtDateTime(c.createdAt)}</span>
              </div>
              <div>{c.bodyText}</div>
            </div>
          ))}
        </div>

        <div className="reply-box">
          <textarea
            placeholder={visibility === 'public' ? 'Reply to requester…' : 'Add an internal note…'}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
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
            <button className="btn primary" disabled={!reply.trim() || comment.isPending} onClick={() => comment.mutate()}>
              {visibility === 'public' ? 'Send reply' : 'Add note'}
            </button>
          </div>
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
        <div className="detail-actions">
          <button className="btn accent" disabled={patch.isPending} onClick={() => patch.mutate({ assigneeId: actingUserId() })}>
            Assign to me
          </button>
          {t.snoozedUntil ? (
            <button className="btn" onClick={() => patch.mutate({ snooze: null })}>Unsnooze</button>
          ) : (
            <button className="btn" onClick={() => setSnoozeOpen(true)}>Snooze…</button>
          )}
        </div>
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
            <select value={t.queue.id} onChange={(e) => patch.mutate({ queueId: Number(e.target.value) })}>
              {meta?.queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </dd>
          <dt>Assignee</dt>
          <dd>{t.assignee?.name ?? 'Unassigned'}</dd>
          <dt>Requester</dt>
          <dd>{t.requester.name}{t.requester.isVip ? ' ★' : ''} · {t.requester.department ?? '—'}</dd>
          <dt>Category</dt>
          <dd>{t.category ?? '—'}</dd>
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
