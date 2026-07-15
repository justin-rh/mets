import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveIncidents, type ActiveIncident } from '../api';
import { age } from '../format';
import { toast } from './Toasts';

/**
 * App-wide amber bar while a suspected incident is open, on every page and in the
 * requester portal. Also the toast source: a newly declared incident and
 * each absorbed report announce themselves wherever you happen to be.
 */
export function IncidentBanner({ onOpen }: { onOpen?: (i: ActiveIncident) => void }) {
  const { data } = useQuery({
    queryKey: ['active-incidents'],
    queryFn: fetchActiveIncidents,
    refetchInterval: 10_000,
  });

  // id -> childCount from the previous poll; null = first load (no toast storm).
  const seen = useRef<Map<number, number> | null>(null);
  useEffect(() => {
    if (!data) return;
    if (seen.current !== null) {
      for (const i of data) {
        const prev = seen.current.get(i.id);
        const open = onOpen ? () => onOpen(i) : undefined;
        if (prev === undefined) {
          toast(`⚠️ Suspected incident declared: ${i.title} — ${i.childCount} reports linked`, 'new', undefined, open);
        } else if (i.childCount > prev) {
          toast(`⚠️ ${i.number} absorbed another report (${i.childCount} linked)`, 'info', undefined, open);
        }
      }
    }
    seen.current = new Map(data.map((i) => [i.id, i.childCount]));
  }, [data]);

  if (!data?.length) return null;
  return (
    <div className="incident-banner" role="alert">
      {data.map((i) => (
        <button
          key={i.id}
          className="incident-banner-item"
          disabled={!onOpen}
          onClick={() => onOpen?.(i)}
          title={onOpen ? `Open ${i.number}` : undefined}
        >
          <span className="incident-pulse" aria-hidden />
          <strong className="incident-label">Suspected incident</strong>
          <span className="incident-title">{i.title}</span>
          <span className="incident-meta">
            {i.number} · {i.childCount} linked report{i.childCount === 1 ? '' : 's'} · started {age(i.createdAt)} ago
          </span>
          {onOpen && <span className="incident-open">Open →</span>}
        </button>
      ))}
    </div>
  );
}
