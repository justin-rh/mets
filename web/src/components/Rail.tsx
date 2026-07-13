import { useDroppable } from '@dnd-kit/core';
import type { AgentInfo, Meta } from '../api';
import { actingUserId, type Mode } from '../board';
import { initials } from '../format';

function DropCard({ id, className, onClick, children }: {
  id: string; className?: string; onClick?: () => void; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`drop-card ${className ?? ''} ${isOver ? 'over' : ''}`} onClick={onClick}>
      {children}
    </div>
  );
}

function AgentCard({ a, isMe }: { a: AgentInfo; isMe: boolean }) {
  return (
    <DropCard id={`agent-${a.id}`} className={`agent-card ${isMe ? 'agent-me' : ''}`}>
      <span className="avatar">{initials(a.name)}</span>
      <span className="agent-info">
        <strong>{a.name}{isMe ? ' (you)' : ''}</strong>
        <span className="loadbar">
          <span className="loadbar-fill" style={{ width: `${Math.min(100, (a.openCount / a.maxOpen) * 100)}%` }} />
        </span>
        <span className="rail-sub">
          {a.openCount} open
          {a.skills.length > 0 && ` · ${a.skills.slice(0, 3).map((s) => s.name).join(', ')}`}
        </span>
      </span>
    </DropCard>
  );
}

/** Left rail: you first, divider, then other agents alphabetically. */
export function AgentRail({ meta, queueId, mode }: { meta: Meta | undefined; queueId?: number; mode: Mode }) {
  if (!meta) return <aside className="rail rail-left" />;
  const me = actingUserId();
  const myAgent = meta.agents.find((a) => a.id === me);
  const myTeamIds = new Set(myAgent?.teamIds ?? []);

  let others = meta.agents.filter((a) => a.id !== me);
  if (queueId) others = others.filter((a) => a.teamIds.includes(queueId));
  // My Categories: only teammates — agents who share a queue with you.
  if (mode === 'My Categories') others = others.filter((a) => a.teamIds.some((t) => myTeamIds.has(t)));
  others.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="rail rail-left">
      <div className="rail-title">Agents — drop to assign</div>
      <div className="agent-list">
        {myAgent && <AgentCard a={myAgent} isMe />}
        {myAgent && others.length > 0 && <div className="rail-divider" />}
        {others.map((a) => <AgentCard key={a.id} a={a} isMe={false} />)}
      </div>
    </aside>
  );
}

/** Right rail: quick assigns, then your queues / divider / other queues, holding area. */
export function ActionRail({ mode, meta, queueId, onSelectQueue }: {
  mode: Mode;
  meta: Meta | undefined;
  queueId?: number;
  onSelectQueue: (id: number | undefined) => void;
}) {
  if (!meta) return <aside className="rail rail-right" />;
  const myTeamIds = new Set(meta.agents.find((a) => a.id === actingUserId())?.teamIds ?? []);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const myQueues = meta.queues.filter((q) => myTeamIds.has(q.id)).sort(byName);
  const otherQueues = meta.queues.filter((q) => !myTeamIds.has(q.id)).sort(byName);

  const queueCard = (q: Meta['queues'][number]) => (
    <DropCard
      key={q.id}
      id={`queue-${q.id}`}
      className={`queue-card clickable ${q.id === queueId ? 'active' : ''}`}
      onClick={() => onSelectQueue(q.id === queueId ? undefined : q.id)}
    >
      <strong>{q.name}</strong>
      <span className="rail-sub">{q.openCount} open · {q.assignmentPolicy.replace('_', ' ')}</span>
    </DropCard>
  );

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
      {myQueues.map(queueCard)}
      {myQueues.length > 0 && otherQueues.length > 0 && <div className="rail-divider" />}
      {otherQueues.map(queueCard)}

      {mode === 'AI Triage' && (
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
