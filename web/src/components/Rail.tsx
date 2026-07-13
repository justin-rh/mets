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

/** Left rail: agents as drop targets. */
export function AgentRail({ meta, queueId }: { meta: Meta | undefined; queueId?: number }) {
  if (!meta) return <aside className="rail rail-left" />;
  const me = actingUserId();

  const agents = meta.agents
    .filter((a) => (queueId ? a.teamIds.includes(queueId) : true))
    .sort((a, b) => a.openCount - b.openCount);

  return (
    <aside className="rail rail-left">
      <div className="rail-title">Agents{queueId ? ' in queue' : ''} — drop to assign</div>
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
    </aside>
  );
}

/** Right rail: everything else — quick assigns, queues, holding area. */
export function ActionRail({ mode, meta }: { mode: Mode; meta: Meta | undefined }) {
  if (!meta) return <aside className="rail rail-right" />;

  return (
    <aside className="rail rail-right">
      <div className="rail-title">Quick actions</div>
      <DropCard id="assign-me" className="assign-me">
        <strong>Assign to me</strong>
        <span className="rail-sub">or use the button on any ticket</span>
      </DropCard>
      <DropCard id="assign-auto" className="assign-auto">
        <strong>Auto-assign</strong>
        <span className="rail-sub">round-robin, load-capped</span>
      </DropCard>

      <div className="rail-title">Queues — drop to move</div>
      {meta.queues.map((q) => (
        <DropCard key={q.id} id={`queue-${q.id}`} className="queue-card">
          <strong>{q.name}</strong>
          <span className="rail-sub">{q.openCount} open · {q.assignmentPolicy.replace('_', ' ')}</span>
        </DropCard>
      ))}

      {mode === 'Triage' && (
        <div className="rail-info">
          <div className="rail-title">AI Triage</div>
          <p>
            Claude classifies category, queue, and priority with per-field
            confidence. High confidence auto-applies on new tickets (logged as
            AI events, revertible); everything else is one click here.
          </p>
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
