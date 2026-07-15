import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchTicket, fetchTickets, fetchUsers, postComment, submitCsat,
  type TicketListItem,
} from '../api';
import { age, fmtDateTime } from '../format';
import { AttachmentStrip, usePasteAttach } from './Attachments';
import { IncidentBanner } from './IncidentBanner';
import { KnowledgeBase } from './KnowledgeBase';
import { NewTicketDialog } from './NewTicketDialog';
import { Toasts } from './Toasts';
import { isEntra, signOut } from '../auth';

function CsatWidget({ ticketId, rated }: { ticketId: number; rated: number | null }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => submitCsat(ticketId, rating, comment.trim() || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', ticketId] }),
  });

  if (rated != null) {
    return (
      <div className="csat-widget csat-done">
        Thanks for the feedback — you rated this{' '}
        <span className="csat-stars">{'★'.repeat(rated)}{'☆'.repeat(5 - rated)}</span>
      </div>
    );
  }
  return (
    <div className="csat-widget">
      <span className="csat-prompt">How did we do?</span>
      <span className="csat-picker">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`csat-star ${n <= rating ? 'on' : ''}`}
            title={`${n} of 5`}
            onClick={() => setRating(n)}
          >
            {n <= rating ? '★' : '☆'}
          </button>
        ))}
      </span>
      {rating > 0 && (
        <>
          <input
            className="csat-comment"
            placeholder="Anything to add? (optional)"
            value={comment}
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
          />
          <button className="btn primary" disabled={send.isPending} onClick={() => send.mutate()}>
            Submit
          </button>
        </>
      )}
    </div>
  );
}

function PortalTicket({ t, expanded, onToggle }: {
  t: TicketListItem; expanded: boolean; onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const pasteAttach = usePasteAttach(t.id);
  const { data: detail } = useQuery({
    queryKey: ['ticket', t.id],
    queryFn: () => fetchTicket(t.id),
    enabled: expanded,
  });
  const send = useMutation({
    mutationFn: () => postComment(t.id, reply, 'public'),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      qc.invalidateQueries({ queryKey: ['portal-tickets'] });
    },
  });
  const pendingApproval = detail?.approvals?.find((a) => a.state === 'pending');
  const closed = t.status.category === 'resolved' || t.status.category === 'closed';

  return (
    <div className={`portal-ticket ${expanded ? 'expanded' : ''}`}>
      <button className="portal-ticket-row" onClick={onToggle}>
        <span className="ticket-number">{t.number}</span>
        <span className="portal-subject">{t.subject}</span>
        <span className={`status-chip portal-status-${t.status.category}`}>{t.status.name}</span>
        <span className="portal-age">{age(t.updatedAt)}</span>
      </button>
      {expanded && detail && (
        <div className="portal-detail">
          <p className="description">{detail.description}</p>
          <AttachmentStrip ticketId={t.id} attachments={detail.attachments ?? []} />
          {pendingApproval && (
            <div className="approval-banner approval-pending">
              <span className="approval-text">
                ⏳ Waiting on approval from <strong>{pendingApproval.approverName}</strong> before this is worked.
              </span>
            </div>
          )}
          <div className="comments">
            {detail.comments.map((c) => (
              <div key={c.id} className="comment public">
                <div className="comment-head">
                  <strong>{c.author.name}</strong>
                  {c.author.name === 'SOTO Bot' && <span className="auto-badge">⚡ auto</span>}
                  <span className="comment-time">{fmtDateTime(c.createdAt)}</span>
                </div>
                <div>{c.bodyText}</div>
              </div>
            ))}
            {detail.comments.length === 0 && (
              <div className="portal-empty-comments">No replies yet — an agent will follow up here.</div>
            )}
          </div>
          {closed && <CsatWidget ticketId={t.id} rated={detail.csatRating} />}
          <div className="reply-box">
            <textarea
              placeholder={closed ? 'Reply to reopen this ticket…' : 'Add a reply… (paste a screenshot to attach it)'}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onPaste={pasteAttach}
            />
            <div className="reply-actions">
              <button
                className="btn primary"
                disabled={!reply.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                {closed ? 'Reply & reopen' : 'Send reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What a requester sees instead of the agent board: their own tickets, a
 * submit button, and the knowledge base. Everything else is 403 server-side.
 */
export function RequesterPortal({ userId, onSwitchUser, theme, onToggleTheme }: {
  userId: number;
  onSwitchUser: (id: number) => void;
  theme: string;
  onToggleTheme: () => void;
}) {
  const [tab, setTab] = useState<'tickets' | 'kb'>('tickets');
  const [view, setView] = useState<'open' | 'closed'>('open');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data: directory } = useQuery({ queryKey: ['users'], queryFn: fetchUsers, staleTime: 300_000 });
  // Server-side RBAC scopes this to the acting requester's tickets.
  const { data: tickets } = useQuery({
    queryKey: ['portal-tickets', userId, view],
    queryFn: () => fetchTickets({ view, sort: 'date' }),
  });

  const me = directory?.find((u) => u.id === userId);
  const staff = (directory ?? []).filter((u) => u.role !== 'requester');
  const requesters = (directory ?? []).filter((u) => u.role === 'requester');

  return (
    <div className="portal">
      <header className="menubar">
        <button className="logo logo-home" title="Back to my tickets" onClick={() => setTab('tickets')}>
          MET<span>S</span>
        </button>
        <span className="portal-badge">Support Portal</span>
        <div className="spacer" />
        <button className="btn accent new-ticket-btn" onClick={() => setNewOpen(true)}>
          + New Ticket
        </button>
        {isEntra ? (
          <span className="sso-user">
            {me?.name ?? '…'}
            <button className="btn ghost" title="Sign out" onClick={() => signOut()}>Sign out</button>
          </span>
        ) : (
          <select
            className="user-switcher"
            title="Acting as (dev auth)"
            value={userId}
            onChange={(e) => onSwitchUser(Number(e.target.value))}
          >
            <optgroup label="Staff">
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </optgroup>
            <optgroup label="Requesters">
              {requesters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </optgroup>
          </select>
        )}
        <button className="theme-toggle" title="Toggle theme" onClick={onToggleTheme}>
          {theme === 'light' ? '☾' : '☀'}
        </button>
      </header>

      <IncidentBanner />

      <div className="modebar">
        <button className={tab === 'tickets' ? 'active' : ''} onClick={() => setTab('tickets')}>
          My Tickets
        </button>
        <button className={tab === 'kb' ? 'active' : ''} onClick={() => setTab('kb')}>
          Knowledge Base
        </button>
        {tab === 'tickets' && (
          <>
            <span className="mode-hint">Hi {me?.name.split(' ')[0]} — your requests, and where they stand</span>
            <div className="spacer" />
            <label className="portal-view-toggle">
              <select value={view} onChange={(e) => { setView(e.target.value as any); setExpandedId(null); }}>
                <option value="open">Open</option>
                <option value="closed">Resolved & closed</option>
              </select>
            </label>
          </>
        )}
      </div>

      {tab === 'kb' ? (
        <KnowledgeBase />
      ) : (
        <div className="portal-list">
          {(tickets ?? []).map((t) => (
            <PortalTicket
              key={t.id}
              t={t}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
            />
          ))}
          {tickets && tickets.length === 0 && (
            <div className="empty">
              {view === 'open'
                ? 'No open requests — hit “+ New Ticket” if something needs fixing.'
                : 'Nothing resolved or closed yet.'}
            </div>
          )}
        </div>
      )}

      <Toasts />
      {newOpen && <NewTicketDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}
