import { useEffect, useRef, useState } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMe, openChat, setAvailability, type AgentInfo, type Meta } from '../api';
import { actingUserId, type Mode } from '../board';
import { initials } from '../format';
import { toast } from './Toasts';

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

// How far from the rail's visible top/bottom edge the cursor counts as
// "in the scroll zone" — deliberately larger than the visual bar so hitting
// it mid-drag is forgiving.
const SCROLL_BAND_PX = 64;

/**
 * Drag-edge scrolling for a rail. dnd-kit captures the pointer during a
 * drag, so instead of relying on hover targets we track the cursor at the
 * window level: while a drag is in flight and the cursor sits in the top or
 * bottom band of this rail, the rail scrolls that direction. Returns which
 * band the cursor is in (for lighting up the arrow bars).
 */
function useDragEdgeScroll(railRef: React.RefObject<HTMLElement | null>) {
  const { active } = useDndContext();
  const [zone, setZone] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (!active) { setZone(null); return; }
    let current: 'up' | 'down' | null = null;
    const onMove = (e: PointerEvent) => {
      const el = railRef.current;
      let next: 'up' | 'down' | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) {
          if (e.clientY >= r.top && e.clientY <= r.top + SCROLL_BAND_PX) next = 'up';
          else if (e.clientY <= r.bottom && e.clientY >= r.bottom - SCROLL_BAND_PX) next = 'down';
        }
      }
      if (next !== current) { current = next; setZone(next); }
    };
    const t = window.setInterval(() => {
      if (current) railRef.current?.scrollBy({ top: current === 'up' ? -16 : 16 });
    }, 16);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearInterval(t);
      setZone(null);
    };
  }, [active, railRef]);
  return zone;
}

/**
 * The arrow bars pinned to the rail's edges. Purely indicators — the cursor
 * band above does the scrolling — but registered as droppables so releasing
 * a ticket on one is a deliberate no-op instead of hitting whatever card
 * sits underneath.
 *
 * IMPORTANT: these render permanently (dimmed when idle). Mounting them at
 * drag start shifted the rail layout AFTER dnd-kit had measured its drop
 * targets, leaving every cached rect ~40px off — drops on the Holding area
 * (and everything below the bar) landed on stale geometry.
 */
function RailScrollZone({ dir, hot, id }: {
  dir: 'up' | 'down';
  hot: boolean;
  id: string;
}) {
  const { active } = useDndContext();
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`rail-scroll rail-scroll-${dir} ${active ? 'armed' : ''} ${hot ? 'over' : ''}`}
      title="Drag a ticket toward this edge to scroll"
    >
      {dir === 'up' ? '▲' : '▼'}
    </div>
  );
}

function AgentCard({ a, isMe, active, menuOpen, leadQueues, canToggleOoo, onToggleMenu, onViewAssigned }: {
  a: AgentInfo;
  isMe: boolean;
  active: boolean;
  menuOpen: boolean;
  leadQueues: string[];
  canToggleOoo: boolean;
  onToggleMenu: () => void;
  onViewAssigned: () => void;
}) {
  const qc = useQueryClient();
  const availability = useMutation({
    mutationFn: (isAvailable: boolean) => setAvailability(a.id, isAvailable),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['meta'] });
      toast(`${a.name} is ${r.isAvailable ? 'back in office' : 'out of office — no new assignments'}`, 'info');
    },
  });

  return (
    <div className="agent-card-wrap">
      <DropCard
        id={`agent-${a.id}`}
        className={`agent-card clickable ${isMe ? 'agent-me' : ''} ${active ? 'active' : ''} ${a.isAvailable ? '' : 'agent-ooo'}`}
        onClick={onToggleMenu}
      >
        <span className={`avatar ${leadQueues.length ? 'avatar-lead' : ''}`}>{initials(a.name)}</span>
        <span className="agent-info">
          <strong>
            {a.name}{isMe ? ' (you)' : ''}
            {leadQueues.length > 0 && (
              <span className="lead-badge" title={`Lead of ${leadQueues.join(', ')}`}>Lead</span>
            )}
            {!a.isAvailable && (
              <span className="ooo-badge" title="Out of office — excluded from all assignment">OOO</span>
            )}
          </strong>
          <span className="loadbar">
            <span className="loadbar-fill" style={{ width: `${Math.min(100, (a.openCount / a.maxOpen) * 100)}%` }} />
          </span>
          <span className="rail-sub">
            {a.openCount} open
            {a.skills.length > 0 && ` · ${a.skills.slice(0, 3).map((s) => s.name).join(', ')}`}
          </span>
        </span>
      </DropCard>
      {menuOpen && (
        <div className="agent-menu">
          <button className="btn" onClick={onViewAssigned}>
            {active ? 'Clear filter' : `View ${isMe ? 'my' : 'assigned'} queue (${a.openCount})`}
          </button>
          <button className="btn" onClick={() => window.open(`/?requester=${a.id}`, '_blank')}>
            Submitted tickets ↗
          </button>
          {!isMe && (
            <button className="btn" onClick={() => { openChat({ partnerId: a.id }); onToggleMenu(); }}>
              💬 Message
            </button>
          )}
          {canToggleOoo && (
            <button className="btn" disabled={availability.isPending} onClick={() => availability.mutate(!a.isAvailable)}>
              {a.isAvailable
                ? (isMe ? 'Set me out of office' : 'Mark out of office')
                : (isMe ? 'I’m back — set available' : 'Mark available')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Left rail: you first, then your teammates (agents sharing one of your
 * queues) alphabetically, then everyone else in a collapsible section that
 * auto-expands while a drag is in flight so any agent stays a drop target.
 */
export function AgentRail({ meta, queueId, assigneeFilter, onSelectAssignee, onCollapse }: {
  meta: Meta | undefined;
  queueId?: number;
  assigneeFilter?: number;
  onSelectAssignee: (id: number | undefined) => void;
  onCollapse?: () => void;
}) {
  const [menuAgentId, setMenuAgentId] = useState<number | null>(null);
  const [othersOpen, setOthersOpen] = useState(() => localStorage.getItem('mets-agents-others') === '1');
  const { active: dragActive } = useDndContext();
  const { data: meUser } = useQuery({ queryKey: ['me', actingUserId()], queryFn: fetchMe });
  const railRef = useRef<HTMLElement>(null);
  const scrollZone = useDragEdgeScroll(railRef);
  if (!meta) return <aside className="rail rail-left" />;
  const me = actingUserId();
  const isAdmin = meUser?.role === 'admin';
  const myAgent = meta.agents.find((a) => a.id === me);
  const myTeamIds = new Set(myAgent?.teamIds ?? []);
  // Leads can mark their own team's members out of office.
  const iLead = new Set(myAgent?.leadOf ?? []);

  let others = meta.agents.filter((a) => a.id !== me);
  if (queueId) others = others.filter((a) => a.teamIds.includes(queueId));
  const byName = (a: AgentInfo, b: AgentInfo) => a.name.localeCompare(b.name);
  const teammates = others.filter((a) => a.teamIds.some((t) => myTeamIds.has(t))).sort(byName);
  const rest = others.filter((a) => !a.teamIds.some((t) => myTeamIds.has(t))).sort(byName);
  const showOthers = othersOpen || !!dragActive;
  const toggleOthers = () => {
    setOthersOpen((cur) => {
      localStorage.setItem('mets-agents-others', cur ? '0' : '1');
      return !cur;
    });
  };

  const queueName = new Map(meta.queues.map((q) => [q.id, q.name]));
  const card = (a: AgentInfo, isMe: boolean) => (
    <AgentCard
      key={a.id}
      a={a}
      isMe={isMe}
      active={assigneeFilter === a.id}
      menuOpen={menuAgentId === a.id}
      leadQueues={a.leadOf.map((id) => queueName.get(id) ?? '').filter(Boolean)}
      canToggleOoo={isMe || isAdmin || a.teamIds.some((t) => iLead.has(t))}
      onToggleMenu={() => setMenuAgentId(menuAgentId === a.id ? null : a.id)}
      onViewAssigned={() => {
        onSelectAssignee(assigneeFilter === a.id ? undefined : a.id);
        setMenuAgentId(null);
      }}
    />
  );

  return (
    <aside className="rail rail-left" ref={railRef}>
      <RailScrollZone dir="up" hot={scrollZone === 'up'} id="scroll-agents-up" />
      <div className="rail-title rail-title-row">
        Agents — drop to assign, click for options
        {onCollapse && (
          <button className="rail-collapse" title="Collapse this rail" onClick={onCollapse}>«</button>
        )}
      </div>
      <div className="agent-list">
        {myAgent && card(myAgent, true)}
        {myAgent && teammates.length > 0 && <div className="rail-divider" />}
        {teammates.map((a) => card(a, false))}
        {rest.length > 0 && (
          <button
            className="agent-others-toggle"
            title={showOthers ? 'Collapse other agents' : 'Expand other agents'}
            onClick={toggleOthers}
          >
            <span className="agent-others-chevron">{showOthers ? '▾' : '▸'}</span>
            Other agents ({rest.length})
          </button>
        )}
        {showOthers && rest.map((a) => card(a, false))}
      </div>
      <RailScrollZone dir="down" hot={scrollZone === 'down'} id="scroll-agents-down" />
    </aside>
  );
}

/** Right rail: quick actions (assigns + holding area), then your queues / divider / other queues. */
export function ActionRail({ mode, meta, queueId, onSelectQueue, onCollapse }: {
  mode: Mode;
  meta: Meta | undefined;
  queueId?: number;
  onSelectQueue: (id: number | undefined) => void;
  onCollapse?: () => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const scrollZone = useDragEdgeScroll(railRef);
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
    <aside className="rail rail-right" ref={railRef}>
      <RailScrollZone dir="up" hot={scrollZone === 'up'} id="scroll-queues-up" />
      <div className="rail-title rail-title-row">
        Quick actions
        {onCollapse && (
          <button className="rail-collapse" title="Collapse this rail" onClick={onCollapse}>»</button>
        )}
      </div>
      <DropCard id="assign-me" className="assign-me">
        <strong>Assign to me</strong>
        <span className="rail-sub">or use the button on any ticket</span>
      </DropCard>
      <DropCard id="assign-auto" className="assign-auto">
        <strong>Auto-assign</strong>
        <span className="rail-sub">round-robin, load-capped</span>
      </DropCard>
      <DropCard id="assign-expertise" className="assign-expertise">
        <strong>Auto-assign (Expertise)</strong>
        <span className="rail-sub">matches category to agent skills</span>
      </DropCard>
      <DropCard id="assign-mentioned" className="assign-mentioned">
        <strong>Auto-assign (Mentioned)</strong>
        <span className="rail-sub">agent named in the ticket, else round-robin</span>
      </DropCard>
      <DropCard id="snooze-zone" className="snooze-zone">
        <strong>⏸ Holding area</strong>
        <span className="rail-sub">drop tickets to snooze</span>
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

      <RailScrollZone dir="down" hot={scrollZone === 'down'} id="scroll-queues-down" />
    </aside>
  );
}
