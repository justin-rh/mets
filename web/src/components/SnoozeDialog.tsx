import { useState } from 'react';

type Props = {
  count?: number;
  onConfirm: (untilIso: string, reason: string) => void;
  onCancel: () => void;
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WAKE_HOUR = 8; // snoozed tickets wake at the start of the business day

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function SnoozeDialog({ count = 1, onConfirm, onCancel }: Props) {
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date | null>(null);
  const [reason, setReason] = useState('');

  const firstDow = viewMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];
  const canGoBack = viewMonth > new Date(today.getFullYear(), today.getMonth(), 1);

  const pickPreset = (daysAhead: number) => {
    const d = new Date(today.getTime() + daysAhead * 86_400_000);
    setSelected(d);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const nextMonday = () => {
    const d = new Date(today);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    setSelected(d);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const wakeAt = selected
    ? new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), WAKE_HOUR)
    : null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Snooze {count > 1 ? `${count} tickets` : 'ticket'} until…</h3>
        <p className="modal-hint">
          Pick the day it should return to the queue (it wakes at 8:00 that
          morning). Leads still see snoozed tickets, and SLA clocks keep running.
        </p>

        <div className="cal-presets">
          <button className="btn" onClick={() => pickPreset(1)}>Tomorrow</button>
          <button className="btn" onClick={() => pickPreset(3)}>+3 days</button>
          <button className="btn" onClick={nextMonday}>Next Monday</button>
          <button className="btn" onClick={() => pickPreset(7)}>+1 week</button>
        </div>

        <div className="cal">
          <div className="cal-head">
            <button
              className="cal-nav"
              disabled={!canGoBack}
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <strong>{viewMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
            <button
              className="cal-nav"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            >
              ›
            </button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((d) => <span key={d} className="cal-dow">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const past = d <= today;
              const isSel = selected != null && sameDay(d, selected);
              return (
                <button
                  key={d.getDate()}
                  className={`cal-day ${past ? 'cal-past' : ''} ${isSel ? 'cal-selected' : ''} ${sameDay(d, today) ? 'cal-today' : ''}`}
                  disabled={past}
                  onClick={() => setSelected(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {wakeAt && (
          <p className="cal-summary">
            Wakes <strong>{wakeAt.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</strong> at 8:00 AM
          </p>
        )}

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
            disabled={!reason.trim() || !wakeAt}
            onClick={() => onConfirm(wakeAt!.toISOString(), reason.trim())}
          >
            Snooze
          </button>
        </div>
      </div>
    </div>
  );
}
