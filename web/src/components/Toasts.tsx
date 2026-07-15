import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'new';
export type ToastAction = { label: string; onClick: () => void };

let seq = 0;

/**
 * Fire a corner toast from anywhere — no context plumbing needed.
 * With `open`, clicking the toast body jumps somewhere (e.g. the mentioned
 * ticket) instead of just dismissing; a ✕ appears for plain dismissal.
 */
export function toast(text: string, kind: ToastKind = 'info', action?: ToastAction, open?: () => void) {
  window.dispatchEvent(new CustomEvent('mets-toast', { detail: { text, kind, action, open } }));
}

type Toast = { id: number; text: string; kind: ToastKind; action?: ToastAction; open?: () => void };

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as Omit<Toast, 'id'>;
      const id = ++seq;
      setItems((cur) => [...cur.slice(-4), { id, ...detail }]); // max 5 on screen
      // toasts with an action linger longer — the undo window
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), detail.action ? 9000 : 6000);
    };
    window.addEventListener('mets-toast', onToast);
    return () => window.removeEventListener('mets-toast', onToast);
  }, []);

  const dismiss = (id: number) => setItems((cur) => cur.filter((x) => x.id !== id));

  if (items.length === 0) return null;
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span
            className={`toast-text ${t.open ? 'toast-openable' : ''}`}
            title={t.open ? 'Open ticket' : 'Dismiss'}
            onClick={() => { t.open?.(); dismiss(t.id); }}
          >
            {t.text}
          </span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => { t.action!.onClick(); dismiss(t.id); }}
            >
              {t.action.label}
            </button>
          )}
          {t.open && (
            <button className="toast-dismiss" title="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
