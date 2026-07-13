import { useEffect, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { TicketListItem } from '../api';
import { TYPE_LABEL, age, initials, slaView } from '../format';
import { TicketDetail } from './TicketDetail';

type Props = {
  ticket: TicketListItem;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (id: number, shift: boolean) => void;
  onToggleExpand: (id: number) => void;
};

export function TicketRow({ ticket: t, selected, expanded, onToggleSelect, onToggleExpand }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ticket-${t.id}`,
    data: { ticketId: t.id },
  });
  const sla = slaView(t.sla);

  // Drag starts anywhere on the row (>6px movement); a plain click expands.
  // After a drop, the browser still fires a click on the row — swallow it.
  const justDragged = useRef(false);
  useEffect(() => {
    if (isDragging) justDragged.current = true;
  }, [isDragging]);

  return (
    <div className={`ticket ${isDragging ? 'dragging' : ''} ${expanded ? 'expanded' : ''}`} ref={setNodeRef}>
      <div
        className="ticket-row"
        {...listeners}
        {...attributes}
        onClick={() => {
          if (justDragged.current) {
            justDragged.current = false;
            return;
          }
          onToggleExpand(t.id);
        }}
      >
        <span className="drag-handle" title="Drag to assign, move, or snooze">⠿</span>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(t.id, (e.nativeEvent as MouseEvent).shiftKey);
          }}
        />
        <span className={`type-chip type-${t.type}`}>{TYPE_LABEL[t.type]}</span>
        <span className="ticket-number">{t.number}</span>
        <span className="ticket-subject" title={t.subject}>
          {t.subject}
          {t.snoozedUntil && <span className="snooze-flag" title={`Snoozed: ${t.snoozeReason ?? ''}`}> ⏸</span>}
        </span>
        <span className="ticket-tags">
          {t.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </span>
        <span className="ticket-requester" title={t.requester.name}>
          {t.requester.name}
          {t.requester.isVip && <span className="vip" title="VIP">★</span>}
        </span>
        <span className={`priority-pill p${t.priority}`}>P{t.priority}</span>
        <span className="score" title="Ticket score">{t.score}</span>
        <span className="ticket-age" title={new Date(t.createdAt).toLocaleString()}>{age(t.createdAt)}</span>
        {sla ? <span className={`sla-chip sla-${sla.tone}`}>{sla.label}</span> : <span className="sla-chip sla-none">—</span>}
        <span className="status-chip">{t.status.name}</span>
        <span className="assignee" title={t.assignee ? `Assigned: ${t.assignee.name}` : 'Unassigned'}>
          {t.assignee ? initials(t.assignee.name) : '·'}
        </span>
      </div>
      {expanded && <TicketDetail ticketId={t.id} />}
    </div>
  );
}
