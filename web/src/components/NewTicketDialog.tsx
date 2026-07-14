import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actingUserId, createTicket, fetchTicket, fetchUsers } from '../api';

export function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('incident');
  const [onBehalfName, setOnBehalfName] = useState('');
  const [created, setCreated] = useState<{ id: number; number: string } | null>(null);

  const { data: directory } = useQuery({ queryKey: ['users'], queryFn: fetchUsers, staleTime: 300_000 });
  const others = (directory ?? []).filter((u) => u.id !== actingUserId());
  const onBehalfUser = others.find((u) => u.name === onBehalfName.trim());
  const nameEnteredButUnknown = onBehalfName.trim().length > 0 && !onBehalfUser;

  const create = useMutation({
    mutationFn: () => createTicket({ subject, description, type, onBehalfOfId: onBehalfUser?.id }),
    onSuccess: (t) => {
      setCreated(t);
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
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
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
                  <dt>Queue</dt>
                  <dd><strong>{routed!.queue.name}</strong></dd>
                  <dt>Category</dt>
                  <dd><strong>{routed!.category ?? 'Uncategorized'}</strong></dd>
                  <dt>Priority</dt>
                  <dd><strong>P{routed!.priority}</strong></dd>
                  {onBehalfUser && (
                    <>
                      <dt>Filed for</dt>
                      <dd>{onBehalfUser.name} *</dd>
                    </>
                  )}
                </dl>
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
              On behalf of <span className="modal-optional">(optional — leave blank if it's for you)</span>
              <input
                list="user-directory"
                value={onBehalfName}
                onChange={(e) => setOnBehalfName(e.target.value)}
                placeholder="Start typing a name…"
              />
              <datalist id="user-directory">
                {others.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.department ?? ''}{u.location ? ` · ${u.location}` : ''}
                  </option>
                ))}
              </datalist>
              {onBehalfUser && (
                <span className="modal-hint">
                  Filed under {onBehalfUser.name}'s name, marked * as submitted by you.
                </span>
              )}
              {nameEnteredButUnknown && (
                <span className="modal-hint">No matching user — pick a name from the list.</span>
              )}
            </label>
            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="Short description of the issue" />
            </label>
            <label>
              Description
              <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? Who is affected? Any deadline?" />
            </label>
            <p className="modal-hint">
              No category or queue to pick — AI routes it. Priority is
              assessed from the described impact.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn primary"
                disabled={subject.trim().length < 3 || !description.trim() || nameEnteredButUnknown || create.isPending}
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
