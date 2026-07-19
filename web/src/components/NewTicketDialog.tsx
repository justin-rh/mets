import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actingUserId, createTicket, fetchMe, fetchMeta, fetchTicket, patchTicket,
  triageNow, uploadAttachments,
} from '../api';
import { filesFromPaste } from './Attachments';

export function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('incident');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [created, setCreated] = useState<{ id: number; number: string } | null>(null);
  const [moved, setMoved] = useState<{ name: string; trained: boolean } | null>(null);

  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: 300_000 });
  const { data: me } = useQuery({ queryKey: ['me', actingUserId()], queryFn: fetchMe });
  const staff = me?.role === 'admin' || me?.role === 'agent';

  // Queue correction straight from the confirmation screen — a move that
  // contradicts the AI's routing is recorded as training, same as a drag.
  const move = useMutation({
    mutationFn: (queueId: number) => patchTicket(created!.id, { queueId }),
    onSuccess: (r: any, queueId) => {
      setMoved({
        name: meta?.queues.find((q) => q.id === queueId)?.name ?? 'the selected queue',
        trained: !!r?.trained,
      });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticket', created!.id] });
    },
  });

  const create = useMutation({
    // With attachments, triage is held until they're uploaded so the AI
    // can read the screenshots, then kicked explicitly.
    mutationFn: () => createTicket({ subject, description, type, holdTriage: pendingFiles.length > 0 }),
    onSuccess: async (t) => {
      setCreated(t);
      if (pendingFiles.length) {
        try {
          const r = await uploadAttachments(t.id, pendingFiles);
          setUploadedCount(r.attachments.length);
        } catch { /* the ticket exists either way */ }
        triageNow(t.id).catch(() => {});
      }
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  // Poll the fresh ticket until AI triage lands (a few seconds), then show
  // where it was routed. Gives up polling after ~30s but keeps what it has.
  const { data: routed } = useQuery({
    queryKey: ['ticket', created?.id],
    queryFn: () => fetchTicket(created!.id),
    enabled: !!created,
    refetchInterval: (q) =>
      (q.state.data as any)?.ai || q.state.dataUpdateCount > 20 ? false : 1500,
  });
  const ai = (routed as any)?.ai;
  const pendingApproval = routed?.approvals?.find((a) => a.state === 'pending');

  const finish = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => {
          if (created) return;
          const pasted = filesFromPaste(e);
          if (!pasted.length) return;
          e.preventDefault();
          setPendingFiles((cur) => [...cur, ...pasted]);
        }}
      >
        {created ? (
          <>
            <h3>{created.number} created</h3>
            {!ai ? (
              <p className="modal-hint triage-wait">
                <span className="triage-spinner">✨</span> AI triage is reading it now —
                routing lands in a few seconds…
              </p>
            ) : (
              <div className="triage-result">
                {(ai.result?.signals?.length ?? 0) > 0 && (
                  <div className="soto-work">
                    <div className="soto-work-title">🧠 SOTO's work</div>
                    {ai.result.signals.slice(0, 5).map((s: string, i: number) => (
                      <div key={i} className="soto-signal" style={{ animationDelay: `${i * 0.55}s` }}>
                        <span className="soto-signal-marker">→</span> {s}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="triage-verdict"
                  style={{ animationDelay: `${Math.min(ai.result?.signals?.length ?? 0, 5) * 0.55 + 0.25}s` }}
                >
                <dl className="triage-routing">
                  {routed!.subject !== subject.trim() && (
                    <>
                      <dt>Subject</dt>
                      <dd><strong>{routed!.subject}</strong> <span className="triage-onbehalf-note">— AI-written</span></dd>
                    </>
                  )}
                  <dt>Queue</dt>
                  <dd><strong>{routed!.queue.name}</strong></dd>
                  <dt>Category</dt>
                  <dd><strong>{routed!.category ?? 'Uncategorized'}</strong></dd>
                  <dt>Priority</dt>
                  <dd><strong>P{routed!.priority}</strong></dd>
                  {routed!.submittedBy && (
                    <>
                      <dt>Filed for</dt>
                      <dd>
                        <strong>{routed!.requester.name}</strong> *
                        <span className="triage-onbehalf-note"> — detected from your description</span>
                      </dd>
                    </>
                  )}
                  {uploadedCount > 0 && (
                    <>
                      <dt>Attached</dt>
                      <dd>{uploadedCount} file{uploadedCount === 1 ? '' : 's'}</dd>
                    </>
                  )}
                </dl>
                {ai.confidence && (
                  <div className="conf-row" title="SOTO's honest per-field certainty — above the auto-apply gate it acts, below it asks a human">
                    {(['category', 'queue', 'priority'] as const).map((k) => (
                      <span key={k} className="conf-meter">
                        <span className="conf-label">{k}</span>
                        <span className="conf-bar">
                          <span className="conf-fill" style={{ width: `${Math.round((ai.confidence[k] ?? 0) * 100)}%` }} />
                        </span>
                        <span className="conf-pct">{Math.round((ai.confidence[k] ?? 0) * 100)}%</span>
                      </span>
                    ))}
                  </div>
                )}
                {ai.result?.summary && (
                  <p className="triage-summary">✨ {ai.result.summary}</p>
                )}
                {pendingApproval ? (
                  <p className="modal-hint">
                    ⏳ {routed!.category} requests need a manager sign-off — this one
                    was sent to <strong>{pendingApproval.approverName}</strong> for
                    approval before it's worked.
                  </p>
                ) : ai.status === 'auto_applied' ? (
                  <p className="modal-hint">
                    ✨ Routed automatically at{' '}
                    {Math.round((ai.confidence?.category ?? 0) * 100)}% confidence —
                    every change is logged in the ticket's activity trail and one
                    click to revert.
                  </p>
                ) : (
                  <p className="modal-hint">
                    ✨ AI read it but wasn't confident enough to auto-route
                    {ai.result?.category ? ` (best guess: ${ai.result.category})` : ''} —
                    it's waiting in <strong>{routed!.queue.name}</strong> for a human
                    to triage.
                  </p>
                )}
                {staff && (
                  moved ? (
                    <p className="modal-hint triage-moved">
                      ✓ Moved to <strong>{moved.name}</strong>
                      {moved.trained && ' — ✨ SOTO learns from this correction'}
                    </p>
                  ) : (
                    <label className="triage-correct">
                      Wrong queue? Move it:
                      <select
                        value={routed!.queue.id}
                        disabled={move.isPending}
                        onChange={(e) => move.mutate(Number(e.target.value))}
                      >
                        {[...(meta?.queues ?? [])]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((q) => (
                            <option key={q.id} value={q.id}>{q.name}</option>
                          ))}
                      </select>
                    </label>
                  )
                )}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={finish}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h3>New ticket</h3>
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="incident">Incident — something is broken</option>
                <option value="request">Request — I need something</option>
                <option value="change">Change — approval to modify a system</option>
              </select>
            </label>
            <label>
              Subject <span className="modal-optional">(optional — AI writes one from your description if left blank)</span>
              <input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="Short description of the issue" />
            </label>
            <label>
              Description <span className="modal-optional">(Markdown supported)</span>
              <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? Who is affected? Any deadline?" />
            </label>
            <label>
              Attachments <span className="modal-optional">(optional — screenshots help a lot; paste one with Ctrl+V)</span>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.xlsx,.docx,.zip,.eml,.msg"
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length) setPendingFiles((cur) => [...cur, ...picked]);
                  e.target.value = '';
                }}
              />
              {pendingFiles.length > 0 && (
                <span className="pending-files">
                  {pendingFiles.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="pending-chip">
                      {f.name}
                      <button
                        type="button"
                        className="pending-remove"
                        title="Remove"
                        onClick={() => setPendingFiles((cur) => cur.filter((_, j) => j !== i))}
                      >✕</button>
                    </span>
                  ))}
                </span>
              )}
            </label>
            <p className="modal-hint">
              No category or queue to pick — AI routes it, and priority is
              assessed from the described impact. Filing for someone else?
              Just say so ("this is for Hannah in the Phoenix warehouse") and
              it's filed under their name.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn primary"
                disabled={!description.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Creating…' : 'Create ticket'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
