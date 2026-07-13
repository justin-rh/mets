import type { Meta } from '../api';

type Props = {
  count: number;
  meta: Meta | undefined;
  onAssignMe: () => void;
  onAutoAssign: () => void;
  onMove: (queueId: number) => void;
  onSnooze: () => void;
  onClose: () => void;
  onClear: () => void;
};

export function BulkBar({ count, meta, onAssignMe, onAutoAssign, onMove, onSnooze, onClose, onClear }: Props) {
  return (
    <div className="bulk-bar">
      <strong>{count} selected</strong>
      <button className="btn accent" onClick={onAssignMe}>Assign to me</button>
      <button className="btn" onClick={onAutoAssign}>Auto-assign</button>
      <select defaultValue="" onChange={(e) => { if (e.target.value) { onMove(Number(e.target.value)); e.target.value = ''; } }}>
        <option value="" disabled>Move to queue…</option>
        {meta?.queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
      </select>
      <button className="btn" onClick={onSnooze}>Snooze…</button>
      <button className="btn" onClick={onClose}>Resolve</button>
      <span className="spacer" />
      <button className="btn ghost" onClick={onClear}>Clear</button>
    </div>
  );
}
