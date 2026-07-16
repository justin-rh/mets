import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTicket, fetchTicket, triageNow, uploadAttachments } from '../api';
import { filesFromPaste } from './Attachments';

export function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('incident');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [created, setCreated] = useState<{ id: number; number: string } | null>(null);

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
