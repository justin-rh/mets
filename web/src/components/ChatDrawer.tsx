import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actingUserId, chatToTicket, fetchChatThread, fetchConversations, fetchMeta,
  sendChatMessage, type ChatConversation,
} from '../api';
import { initials } from '../format';
import { toast } from './Toasts';

const TICKET_SPLIT_RE = /(T-\d{7})/g;
const TICKET_EXACT_RE = /^T-\d{7}$/;

/** Message body with T-####### references turned into ticket deep links. */
function Linkified({ body }: { body: string }) {
  const parts = body.split(TICKET_SPLIT_RE);
  return (
    <>
      {parts.map((part, i) =>
        TICKET_EXACT_RE.test(part) ? (
          <a
            key={i}
            className="chat-ticket-link"
            href={`/?ticket=${part}`}
            target="_blank"
            rel="noreferrer"
            title={`Open ${part} in a new tab`}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ChatDrawer() {
  const qc = useQueryClient();
  const me = actingUserId();
  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastToastedId = useRef<number | null>(null);

  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const { data: conversations } = useQuery({
    queryKey: ['chat-conversations', me],
    queryFn: fetchConversations,
    refetchInterval: 5000,
  });
  const { data: thread } = useQuery({
    queryKey: ['chat-thread', me, partnerId],
    queryFn: () => fetchChatThread(partnerId!, open),
    enabled: partnerId != null,
    refetchInterval: open && partnerId != null ? 3000 : false,
  });

  const send = useMutation({
    mutationFn: () => sendChatMessage(partnerId!, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['chat-thread', me, partnerId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations', me] });
    },
  });

  const toTicket = useMutation({
    mutationFn: () => chatToTicket(partnerId!),
    onSuccess: (t) => {
      toast(`📎 ${t.number} created from this chat — AI is routing it now`, 'success', {
        label: 'Open',
        onClick: () => window.open(`/?ticket=${t.number}`, '_blank'),
      });
      qc.invalidateQueries({ queryKey: ['chat-thread', me, partnerId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: any) => toast(e?.message ?? 'Could not create a ticket from this chat', 'info'),
  });

  const totalUnread = (conversations ?? []).reduce((n, c) => n + c.unread, 0);

  // Toast on a genuinely new incoming message (not on first load, not while
  // that thread is already on screen).
  useEffect(() => {
    if (!conversations?.length) return;
    const newest = conversations[0]!;
    if (lastToastedId.current == null) {
      lastToastedId.current = newest.lastId;
      return;
    }
    if (newest.lastId > lastToastedId.current && !newest.lastFromMe
        && !(open && partnerId === newest.partnerId)) {
      toast(`💬 ${newest.partnerName}: ${newest.lastBody.slice(0, 60)}`, 'new', {
        label: 'Reply',
        onClick: () => { setPartnerId(newest.partnerId); setOpen(true); },
      });
    }
    lastToastedId.current = Math.max(lastToastedId.current, newest.lastId);
  }, [conversations, open, partnerId]);

  // Open-chat events from the agent rail / ticket detail.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { partnerId?: number; prefill?: string };
      setOpen(true);
      if (d.partnerId) setPartnerId(d.partnerId);
      else setPartnerId(null); // pick-a-person mode
      if (d.prefill) setDraft(d.prefill);
    };
    window.addEventListener('mets-chat', onOpen);
    return () => window.removeEventListener('mets-chat', onOpen);
  }, []);

  // Opening a thread marks it read server-side — refresh the unread badge
  // right away instead of waiting for the next conversations poll.
  const threadLoaded = !!thread;
  useEffect(() => {
    if (open && partnerId != null && threadLoaded) {
      qc.invalidateQueries({ queryKey: ['chat-conversations', me] });
    }
  }, [open, partnerId, threadLoaded, me, qc]);

  // Reset when the acting user changes; keep the scroll pinned to the newest.
  useEffect(() => { setPartnerId(null); lastToastedId.current = null; }, [me]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread?.length, partnerId, open]);

  // Directory = agents/admins (bot is excluded server-side from meta) merged
  // with conversation state; people you've talked to sort first.
  const directory = useMemo(() => {
    const byId = new Map<number, ChatConversation>();
    for (const c of conversations ?? []) byId.set(c.partnerId, c);
    const agents = (meta?.agents ?? []).filter((a) => a.id !== me);
    const known = (conversations ?? []).map((c) => ({
      id: c.partnerId, name: c.partnerName,
      isAvailable: c.isAvailable, convo: c,
    }));
    const rest = agents
      .filter((a) => !byId.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, isAvailable: a.isAvailable, convo: undefined }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...known, ...rest];
  }, [conversations, meta, me]);

  // Filter only what the list renders — the open thread's partner lookup
  // must not disappear behind a stale search.
  const filteredDirectory = useMemo(() => {
    const q = personFilter.trim().toLowerCase();
    return q ? directory.filter((d) => d.name.toLowerCase().includes(q)) : directory;
  }, [directory, personFilter]);

  const partner = directory.find((d) => d.id === partnerId);

  return (
    <>
      <button
        className={`chat-fab ${totalUnread > 0 ? 'has-unread' : ''}`}
        title="Agent chat"
        onClick={() => setOpen((v) => !v)}
      >
        💬
        {totalUnread > 0 && <span className="chat-fab-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
      </button>

      {open && (
        <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
          {partnerId == null || !partner ? (
            <>
              <div className="chat-head">
                <strong>Chat</strong>
                <button className="chat-close" onClick={() => setOpen(false)}>✕</button>
              </div>
              {draft.trim() && (
                <div className="chat-prefill-note">Sending: “{draft.slice(0, 48)}…” — pick a person</div>
              )}
              <input
                className="chat-search"
                placeholder="🔎 Find a person…"
                value={personFilter}
                autoFocus
                onChange={(e) => setPersonFilter(e.target.value)}
                onKeyDown={(e) => {
                  // Enter opens the single (or top) match — type-and-go.
                  if (e.key === 'Enter' && filteredDirectory.length > 0) {
                    setPartnerId(filteredDirectory[0]!.id);
                    setPersonFilter('');
                  }
                }}
              />
              <div className="chat-list">
                {filteredDirectory.length === 0 && (
                  <div className="chat-empty">Nobody matches “{personFilter}”.</div>
                )}
                {filteredDirectory.map((d) => (
                  <button key={d.id} className="chat-list-item" onClick={() => { setPartnerId(d.id); setPersonFilter(''); }}>
                    <span className={`avatar ${d.isAvailable ? '' : 'avatar-ooo'}`}>{initials(d.name)}</span>
                    <span className="chat-list-main">
                      <span className="chat-list-name">
                        {d.name}
                        {!d.isAvailable && <span className="ooo-badge">OOO</span>}
                      </span>
                      {d.convo && (
                        <span className="chat-list-preview">
                          {d.convo.lastFromMe ? 'You: ' : ''}{d.convo.lastBody.slice(0, 42)}
                        </span>
                      )}
                    </span>
                    {d.convo && <span className="chat-list-time">{timeLabel(d.convo.lastAt)}</span>}
                    {d.convo && d.convo.unread > 0 && (
                      <span className="chat-unread">{d.convo.unread}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="chat-head">
                <button className="chat-back" onClick={() => setPartnerId(null)}>‹</button>
                <span className={`avatar ${partner.isAvailable ? '' : 'avatar-ooo'}`}>{initials(partner.name)}</span>
                <strong>{partner.name}</strong>
                {!partner.isAvailable && <span className="ooo-badge">OOO</span>}
                {(thread ?? []).length > 0 && (
                  <button
                    className="chat-to-ticket"
                    disabled={toTicket.isPending}
                    title={`Turn the recent messages into a ticket — ${partner.name.split(' ')[0]} becomes the requester, the transcript rides as the description, and AI routes it like any other ticket`}
                    onClick={() => toTicket.mutate()}
                  >
                    {toTicket.isPending ? '…' : '📎 → ticket'}
                  </button>
                )}
                <button className="chat-close" onClick={() => setOpen(false)}>✕</button>
              </div>
              <div className="chat-thread" ref={scrollRef}>
                {(thread ?? []).map((m) => (
                  <div key={m.id} className={`chat-msg ${m.fromId === me ? 'mine' : 'theirs'}`}>
                    <div className="chat-bubble"><Linkified body={m.body} /></div>
                    <div className="chat-msg-time">{timeLabel(m.createdAt)}</div>
                  </div>
                ))}
                {(thread ?? []).length === 0 && (
                  <div className="chat-empty">No messages yet — say hi. Ticket numbers like T-1000042 become links.</div>
                )}
              </div>
              <div className="chat-compose">
                <textarea
                  rows={2}
                  placeholder={`Message ${partner.name.split(' ')[0]}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                      e.preventDefault();
                      send.mutate();
                    }
                  }}
                />
                <button
                  className="btn primary"
                  disabled={!draft.trim() || send.isPending}
                  onClick={() => send.mutate()}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
