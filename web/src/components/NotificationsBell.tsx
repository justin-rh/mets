import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actingUserId, fetchNotifications, saveNotificationPrefs, type NotificationPrefs } from '../api';
import { age } from '../format';

const TYPE_META: Record<string, { icon: string; label: string }> = {
  assigned: { icon: '👤', label: 'Assigned to you' },
  sla_warning: { icon: '⏳', label: 'SLA at risk' },
  sla_breached: { icon: '⚠️', label: 'SLA breached' },
  created: { icon: '📥', label: 'New in your queue' },
  email_reply: { icon: '✉️', label: 'Requester replied' },
};

const PREF_LABELS: [keyof NotificationPrefs, string][] = [
  ['assignedToMe', 'Tickets assigned to me'],
  ['slaAlerts', 'SLA warnings & breaches on my tickets'],
  ['queueActivity', 'New tickets in my queues'],
  ['emailReplies', 'Email replies on my tickets'],
];

export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenKey = `mets-notif-seen-${actingUserId()}`;
  const [seenAt, setSeenAt] = useState(() => Number(localStorage.getItem(seenKey) ?? 0));

  const { data } = useQuery({
    queryKey: ['notifications', actingUserId()],
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
  });

  const savePrefs = useMutation({
    mutationFn: saveNotificationPrefs,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = (data?.items ?? []).filter((n) => new Date(n.at).getTime() > seenAt).length;

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      localStorage.setItem(seenKey, String(now));
      setSeenAt(now);
    } else {
      setShowPrefs(false);
    }
  };

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPrefs(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="notif-wrap" ref={panelRef}>
      <button className="theme-toggle notif-bell" title="Notifications" onClick={toggleOpen}>
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button className="btn ghost" onClick={() => setShowPrefs((v) => !v)}>
              {showPrefs ? 'Done' : '⚙ Settings'}
            </button>
          </div>
          {showPrefs && data && (
            <div className="notif-prefs">
              {PREF_LABELS.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={data.prefs[key]}
                    onChange={(e) => savePrefs.mutate({ ...data.prefs, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="notif-list">
            {(data?.items ?? []).map((n) => {
              const meta = TYPE_META[n.type] ?? { icon: '•', label: n.type };
              return (
                <a key={n.id} className="notif-item" href={`/?ticket=${n.number}`}>
                  <span className="notif-icon">{meta.icon}</span>
                  <span className="notif-body">
                    <span className="notif-label">{meta.label} · {n.number}</span>
                    <span className="notif-subject">{n.subject}</span>
                  </span>
                  <span className="notif-age">{age(n.at)}</span>
                </a>
              );
            })}
            {(data?.items ?? []).length === 0 && (
              <div className="notif-empty">Nothing new in the last 7 days.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
