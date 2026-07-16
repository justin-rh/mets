import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMailbox, fetchOutbound, fetchSenders, sendInboundEmail } from '../api';
import { fmtDateTime } from '../format';

export function EmailSimulator() {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);

  const { data: senders } = useQuery({ queryKey: ['mail-senders'], queryFn: fetchSenders });
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json()),
    staleTime: 300_000,
  });
  const mailAdapter: string = health?.adapters?.mail ?? 'mock';
  const effectiveFrom = from || senders?.[0]?.email || '';

  const { data: mailbox } = useQuery({
    queryKey: ['mailbox', effectiveFrom],
    queryFn: () => fetchMailbox(effectiveFrom),
    enabled: !!effectiveFrom,
    refetchInterval: 5_000, // agent replies appear "live" in the inbox
  });
  const { data: outbound } = useQuery({
    queryKey: ['outbound', effectiveFrom],
    queryFn: () => fetchOutbound(effectiveFrom),
    enabled: !!effectiveFrom,
    refetchInterval: 5_000,
  });

  const send = useMutation({
    mutationFn: () => sendInboundEmail({ from: effectiveFrom, subject, body }),
    onSuccess: (r) => {
      setLastResult(
        r.action === 'created'
          ? `Delivered — ticket ${r.number} created. AI triage is categorizing it now.`
          : `Delivered — appended to ${r.number}.`,
      );
      setSubject('');
      setBody('');
      qc.invalidateQueries({ queryKey: ['mailbox'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return (
    <div className="mail-sim">
      <div className="mail-compose">
        <div className="mail-demo-note">
          <strong>Mail adapter: {mailAdapter}.</strong>{' '}
          {mailAdapter === 'smtp'
            ? 'Outbound notifications really send over SMTP (✓ delivered badges below). Inbound stays simulated here until the Graph mailbox adapter is activated — see docs/EMAIL.md.'
            : 'This simulates the shared helpdesk mailbox — outbound activates with SMTP env config (docs/EMAIL.md), and the same pipeline (subject-token threading, guest contacts, auto-ack, reopen on reply) carries real mail.'}
        </div>
        <label>
          From (any address works — unknown senders become guest contacts)
          <input
            list="sender-list"
            value={from}
            placeholder={senders?.[0]?.email ?? 'someone@masterelectronics.com'}
            onChange={(e) => setFrom(e.target.value)}
          />
          <datalist id="sender-list">
            {senders?.map((s) => <option key={s.email} value={s.email}>{s.name}{s.department ? ` — ${s.department}` : ''}</option>)}
          </datalist>
        </label>
        <label>
          Subject (include a ticket token like [T-1000042] to reply to it)
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="My laptop won't connect to the dock" />
        </label>
        <label>
          Body
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the problem the way a requester would…" />
        </label>
        <div className="mail-actions">
          <button
            className="btn accent"
            disabled={!effectiveFrom || !subject.trim() || !body.trim() || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending…' : 'Send to helpdesk@'}
          </button>
          {lastResult && <span className="mail-result">{lastResult}</span>}
        </div>
      </div>

      <div className="mail-inbox">
        <div className="rail-title">Inbox of {effectiveFrom || '…'}</div>
        {(outbound?.length ?? 0) > 0 && (
          <div className="mail-thread mail-notify-thread">
            <div className="mail-thread-head">
              <strong>📧 Notifications ({outbound!.length})</strong>
              <span className="mail-thread-meta">queue-entry alerts sent to this address</span>
            </div>
            {outbound!.map((m) => (
              <div key={m.id} className="mail-entry mail-ack">
                <div className="mail-entry-head">
                  <span>
                    helpdesk@masterelectronics.com
                    {m.ticketNumber && (
                      <button
                        className="btn ghost mail-reply-btn"
                        onClick={() => window.open(`/?ticket=${m.ticketNumber}`, '_blank')}
                      >
                        open {m.ticketNumber} ↗
                      </button>
                    )}
                  </span>
                  <span className="comment-time">
                    {m.deliveredAt && <span className="mail-delivery ok" title={`Delivered via SMTP ${fmtDateTime(m.deliveredAt)}`}>✓ delivered</span>}
                    {m.deliveryError && <span className="mail-delivery err" title={m.deliveryError}>✕ send failed</span>}
                    {fmtDateTime(m.createdAt)}
                  </span>
                </div>
                <div className="mail-entry-body"><strong>{m.subject}</strong>{'\n'}{m.body}</div>
              </div>
            ))}
          </div>
        )}
        {mailbox?.threads.length === 0 && (outbound?.length ?? 0) === 0 && (
          <div className="empty">No email tickets yet for this address — send one.</div>
        )}
        {mailbox?.threads.map((t) => (
          <div key={t.number} className="mail-thread">
            <div className="mail-thread-head">
              <strong>{t.subject}</strong>
              <span className="mail-thread-meta">
                {t.category ?? 'awaiting triage'} · {t.status}
                <button
                  className="btn ghost mail-reply-btn"
                  onClick={() => { setSubject(`RE: [${t.number}] ${t.subject.replace(/^\[T-\d+\]\s*/, '')}`); window.scrollTo(0, 0); }}
                >
                  Reply
                </button>
              </span>
            </div>
            {t.entries.map((e, i) => (
              <div key={i} className={`mail-entry mail-${e.kind}`}>
                <div className="mail-entry-head">
                  <span>{e.from}</span>
                  <span className="comment-time">{fmtDateTime(e.at)}</span>
                </div>
                <div className="mail-entry-body">{e.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
