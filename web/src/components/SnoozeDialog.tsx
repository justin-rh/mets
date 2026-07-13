import { useState } from 'react';

type Props = {
  count?: number;
  onConfirm: (untilIso: string, reason: string) => void;
  onCancel: () => void;
};

export function SnoozeDialog({ count = 1, onConfirm, onCancel }: Props) {
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState('');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Snooze {count > 1 ? `${count} tickets` : 'ticket'}</h3>
        <p className="modal-hint">
          Snoozed tickets leave the queue view and return automatically.
          Leads can see all snoozed tickets, and SLA clocks keep running.
        </p>
        <label>
          Wake in
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={2}>2 days</option>
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>1 week</option>
            <option value={14}>2 weeks</option>
          </select>
        </label>
        <label>
          Reason (required)
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Waiting for parts arriving Thursday"
          />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn primary"
            disabled={!reason.trim()}
            onClick={() => onConfirm(new Date(Date.now() + days * 86_400_000).toISOString(), reason.trim())}
          >
            Snooze
          </button>
        </div>
      </div>
    </div>
  );
}
