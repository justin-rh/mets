import { useEffect, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { TicketListItem } from '../api';
import { TYPE_LABEL, age, initials, slaView } from '../format';
import { useAwayTag } from '../useAwayTag';
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
  const isAway = useAwayTag();

  // Drag starts anywhere on the row (>6px movement); a plain click expands.
  // After a drop, the browser still fires a click on the row — swallow it.
  const justDragged = useRef(false);
  useEffect(() => {
    if (isDragging) justDragged.current = true;
  }, [isDragging]);

  return (
    <div className={`ticket pri-${t.priority} ${isDragging ? 'dragging' : ''} ${expanded ? 'expanded' : ''}`} ref={setNodeRef}>
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
        <span
          className="ticket-subject"
          title={t.flags?.length
            ? `${t.subject}\n🚩 ${t.flags.map((f) => `${f.term} (+${f.boost})`).join(', ')}`
            : t.subject}
        >
          {t.flags?.length > 0 && <span className="flag-icon">🚩</span>}
          {t.sentiment === 'frustrated' && (
            <span className="sent-icon" title="AI read the requester as frustrated — score boosted">😤</span>
          )}
          {t.sentiment === 'urgent' && (
            <span className="sent-icon" title="AI read urgency in the tone — score boosted">⚡</span>
          )}
          {t.shouting && (
            <span className="sent-icon" title="Written in ALL CAPS — score docked. Shouting does not make it more urgent.">🔇</span>
          )}
          {t.subject}
          {t.snoozedUntil && <span className="snooze-flag" title={`Snoozed: ${t.snoozeReason ?? ''}`}> ⏸</span>}
        </span>
        <span
          className={`ticket-tags ${expanded ? 'expanded' : ''}`}
          title={t.tags.length ? t.tags.join(', ') : undefined}
        >
          {/* Collapsed rows show one tag — prefer an away-site tag so it's never buried in the +N. */}
          {(expanded ? t.tags : [t.tags.find(isAway) ?? t.tags[0]].filter(Boolean) as string[]).map((tag) => (
            <span
              key={tag}
              className={`tag ${isAway(tag) ? 'tag-away' : ''}`}
              title={isAway(tag) ? 'Requester is at a different site than you' : undefined}
            >
              {tag}
            </span>
          ))}
          {!expanded && t.tags.length > 1 && <span className="tag tag-more">+{t.tags.length - 1}</span>}
        </span>
        <span
          className="queue-cell"
          title={`Queue: ${t.queue.name}${t.category ? ` · Category: ${t.category}` : ''}`}
        >
          <span className="queue-cell-queue">{t.queue.name}</span>
          {t.category !== t.queue.name && (
            <span className="queue-cell-category">{t.category ?? 'uncategorized'}</span>
          )}
        </span>
        <span
          className="ticket-requester"
          title={t.submittedBy
            ? `${t.requester.name} — submitted on their behalf by ${t.submittedBy.name}`
            : t.requester.name}
        >
          {t.requester.name}
          {t.submittedBy && <span className="on-behalf">*</span>}
          {t.requester.isVip && <span className="vip" title="VIP">★</span>}
        </span>
        <span className={`pri-badge p${t.priority}`}>P{t.priority}</span>
        <span className="score" title="Ticket score">{t.score}</span>
        <span className="ticket-age" title={new Date(t.createdAt).toLocaleString()}>{age(t.createdAt)}</span>
        {sla ? (
          <span
            className={`sla-cell sla-${sla.tone}`}
            title={sla.tone === 'breach' ? `SLA breached ${sla.label}` : `Resolution SLA: ${sla.label} remaining`}
          >
            <span className="sla-meter">
              <span className="sla-meter-fill" style={{ width: `${Math.round(sla.fraction * 100)}%` }} />
            </span>
            <span className="sla-text">{sla.label}</span>
          </span>
        ) : (
          <span className="sla-cell sla-none">—</span>
        )}
        <span className="status-chip">{t.status.name}</span>
        <span className="assignee" title={t.assignee ? `Assigned: ${t.assignee.name}` : 'Unassigned'}>
          {t.assignee ? initials(t.assignee.name) : '·'}
        </span>
      </div>
      {expanded && <TicketDetail ticketId={t.id} />}
    </div>
  );
}
