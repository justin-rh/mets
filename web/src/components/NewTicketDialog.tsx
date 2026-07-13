import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTicket } from '../api';

export function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('incident');
  const [createdNumber, setCreatedNumber] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createTicket({ subject, description, type }),
    onSuccess: (t) => {
      setCreatedNumber(t.number);
      // AI enrichment lands a few seconds after create — refresh views then,
      // so the category/priority events appear without a manual reload.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['tickets'] });
        qc.invalidateQueries({ queryKey: ['meta'] });
      }, 8000);
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        {createdNumber ? (
          <>
            <h3>{createdNumber} created</h3>
            <p className="modal-hint">
              AI triage is categorizing it now — confident changes apply
              automatically and show as <strong>ai</strong> events in the
              ticket's activity trail. Sort the queue by date to see it.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>Done</button>
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
              Subject
              <input autoFocus value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="Short description of the issue" />
            </label>
            <label>
              Description
              <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? Who is affected? Any deadline?" />
            </label>
            <p className="modal-hint">
              No category or queue to pick — AI routes it. Your priority is
              assessed from the described impact.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn primary"
                disabled={subject.trim().length < 3 || !description.trim() || create.isPending}
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
