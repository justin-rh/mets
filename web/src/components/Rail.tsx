import { useDroppable } from '@dnd-kit/core';
import type { Meta } from '../api';
import { actingUserId, type Mode } from '../board';
import { initials } from '../format';

function DropCard({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`drop-card ${className ?? ''} ${isOver ? 'over' : ''}`}>
      {children}
    </div>
  );
}

export function Rail({ mode, meta, queueId }: { mode: Mode; meta: Meta | undefined; queueId?: number }) {
  if (!meta) return <aside className="rail" />;
  const me = actingUserId();

  const agents = meta.agents
    .filter((a) => (queueId ? a.teamIds.includes(queueId) : true))
    .sort((a, b) => a.openCount - b.openCount);

  return (
    <aside className="rail">
      {mode === 'Assign' && (
        <>
          <div className="rail-title">Drop tickets to assign</div>
          <DropCard id="assign-me" className="assign-me">
            <strong>Assign to me</strong>
            <span className="rail-sub">or use the button on any ticket</span>
          </DropCard>
          <DropCard id="assign-auto" className="assign-auto">
            <strong>Auto-assign</strong>
            <span className="rail-sub">round-robin now · AI on Day 4</span>
          </DropCard>
          <div className="rail-title">Agents{queueId ? ' in queue' : ''}</div>
          <div className="agent-list">
            {agents.map((a) => (
              <DropCard key={a.id} id={`agent-${a.id}`} className="agent-card">
                <span className="avatar">{initials(a.name)}</span>
                <span className="agent-info">
                  <strong>{a.name}{a.id === me ? ' (you)' : ''}</strong>
                  <span className="loadbar">
                    <span className="loadbar-fill" style={{ width: `${Math.min(100, (a.openCount / a.maxOpen) * 100)}%` }} />
                  </span>
                  <span className="rail-sub">
                    {a.openCount} open
                    {a.skills.length > 0 && ` · ${a.skills.slice(0, 3).map((s) => s.name).join(', ')}`}
                  </span>
                </span>
              </DropCard>
            ))}
          </div>
        </>
      )}

      {mode === 'Move' && (
        <>
          <div className="rail-title">Drop tickets to move</div>
          {meta.queues.map((q) => (
            <DropCard key={q.id} id={`queue-${q.id}`} className="queue-card">
              <strong>{q.name}</strong>
              <span className="rail-sub">{q.openCount} open · {q.assignmentPolicy.replace('_', ' ')}</span>
            </DropCard>
          ))}
        </>
      )}

      {mode === 'Triage' && (
        <div className="rail-info">
          <div className="rail-title">AI Triage</div>
          <p>
            AI categorization, priority checks, and queue suggestions land here
            on Day 4 — auto-applied when confident, one-click when not.
          </p>
        </div>
      )}

      {mode === 'My Queue' && (
        <div className="rail-info">
          <div className="rail-title">My queue</div>
          <p>Tickets assigned to you. Drag to the holding area below to snooze.</p>
        </div>
      )}

      <div className="rail-spacer" />
      <DropCard id="snooze-zone" className="snooze-zone">
        <strong>⏸ Holding area</strong>
        <span className="rail-sub">drop tickets to snooze</span>
      </DropCard>
    </aside>
  );
}
