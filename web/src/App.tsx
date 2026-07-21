import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection,
  useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';

// The drop target is whatever is under the mouse cursor; rectangle overlap
// only as a fallback when the pointer isn't inside any droppable.
const cursorFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  actingUserId, bulkTickets, fetchMe, fetchMeta, fetchTickets, fetchUsers,
  parseSearch, patchTicket, runIncidentDemo, setActingUserId, type ListParams, type NlFilters,
  type TicketChanges, type TicketListItem,
} from './api';
import { RequesterPortal } from './components/RequesterPortal';
import { isEntra, signOut } from './auth';
import { MODES, type Mode } from './board';
import { Admin } from './components/Admin';
import { BulkBar } from './components/BulkBar';
import { Dashboard } from './components/Dashboard';
import { EmailSimulator } from './components/EmailSimulator';
import { KnowledgeBase } from './components/KnowledgeBase';
import { NewTicketDialog } from './components/NewTicketDialog';
import { NotificationsBell } from './components/NotificationsBell';
import { WelcomeCard } from './components/WelcomeCard';
import { ActionRail, AgentRail } from './components/Rail';
import { SnoozeDialog } from './components/SnoozeDialog';
import { TicketRow } from './components/TicketRow';
import { toast, Toasts } from './components/Toasts';
import { ChatDrawer } from './components/ChatDrawer';
import { IncidentBanner } from './components/IncidentBanner';
import { TriagePanel } from './components/TriagePanel';
import './App.css';

const SORTS = ['date', 'score', 'priority', 'requester', 'description', 'random'] as const;

/** Pinned ticket persisted across sessions. */
type PinnedTab = { id: number; number: string; subject: string };

/** The toolbar drop zone: drag a ticket here to pin it as a tab. */
function PinDropZone({ dragging, children }: { dragging: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pin-bar' });
  return (
    <span ref={setNodeRef} className={`pin-bar ${dragging ? 'ready' : ''} ${isOver ? 'over' : ''}`}>
      {children}
    </span>
  );
}

export default function App() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('All Tickets');
  const [sort, setSort] = useState<string>('score');
  // Queue scope: 'mine' (the default — queues your teams own), a specific
  // queue id, or undefined for everything.
  const [queueSel, setQueueSel] = useState<number | 'mine' | undefined>('mine');
  const queueId = typeof queueSel === 'number' ? queueSel : undefined;
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('ticket') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Deep link: /?ticket=T-1000042 seeds the search and auto-expands the match.
  const [linkedTicket] = useState(() => new URLSearchParams(window.location.search).get('ticket'));
  const [linkPending, setLinkPending] = useState(() => !!linkedTicket);
  // Last ticket jumped to via the incident banner / new-ticket toasts. Gets
  // the same view widening as permalinks: resolving the jumped ticket keeps
  // it on screen as Resolved instead of leaving an empty "open" list behind
  // a stale number search.
  const [jumpedTicket, setJumpedTicket] = useState<string | null>(null);
  // Agent filters: assigned queue (from clicking an agent card) and
  // submitted-by (from /?requester=<id>, opened in a new tab).
  const [assigneeFilter, setAssigneeFilter] = useState<number | undefined>();
  const [requesterFilter, setRequesterFilter] = useState<number | undefined>(() => {
    const v = new URLSearchParams(window.location.search).get('requester');
    return v ? Number(v) : undefined;
  });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // Natural-language search: AI-parsed filters override the view while active.
  const [nlFilter, setNlFilter] = useState<{ interpretation: string; filters: NlFilters } | null>(null);
  // Tickets pinned to the toolbar (drag a row up here) — survive refreshes.
  const [pinnedTabs, setPinnedTabs] = useState<PinnedTab[]>(() => {
    try { return JSON.parse(localStorage.getItem('mets-pinned') ?? '[]'); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('mets-pinned', JSON.stringify(pinnedTabs)); }, [pinnedTabs]);
  const [snoozeIds, setSnoozeIds] = useState<number[] | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [page, setPage] = useState<'queue' | 'dashboards' | 'kb' | 'email' | 'admin'>('queue');
  const [userId, setUserId] = useState(actingUserId());
  const [theme, setTheme] = useState(() => localStorage.getItem('mets-theme') ?? 'dark');
  // Rails collapse to slim strips; a drag in flight temporarily expands
  // them so drop targets are always reachable.
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem('mets-rail-left') === '1');
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem('mets-rail-right') === '1');
  useEffect(() => { localStorage.setItem('mets-rail-left', leftCollapsed ? '1' : '0'); }, [leftCollapsed]);
  useEffect(() => { localStorage.setItem('mets-rail-right', rightCollapsed ? '1' : '0'); }, [rightCollapsed]);
  const { data: me } = useQuery({ queryKey: ['me', userId], queryFn: fetchMe });
  const { data: directory } = useQuery({ queryKey: ['users'], queryFn: fetchUsers, staleTime: 300_000 });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mets-theme', theme);
  }, [theme]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const view: ListParams['view'] =
    linkedTicket && debouncedSearch === linkedTicket ? 'all' // permalinks resolve closed tickets too
    : jumpedTicket && debouncedSearch === jumpedTicket ? 'all' // banner/toast jumps likewise
    : requesterFilter ? 'all' // submitted-by view spans open and closed
    : showSnoozed ? 'snoozed'
    : mode === 'Assigned Tickets' ? 'mine'
    : mode === 'Unassigned' ? 'unassigned'
    : mode === 'Closed' ? 'closed'
    : 'open';
  const params: ListParams = nlFilter
    ? { view: 'open', sort, ...nlFilter.filters }
    : {
        view, queueId, assigneeId: assigneeFilter, requesterId: requesterFilter,
        sort, search: debouncedSearch,
        // "My queues" dropdown scope — suppressed for permalinks and the
        // submitted-by view, which must resolve tickets anywhere.
        myQueues: queueSel === 'mine' && view !== 'all' ? '1' : undefined,
      };

  const nlParse = useMutation({
    mutationFn: (query: string) => parseSearch(query),
    onSuccess: (r) => {
      setNlFilter({ interpretation: r.interpretation, filters: r.filters });
      setSearch('');
      toast(`✨ ${r.interpretation}`, 'info');
    },
    onError: () => toast('Could not parse that — try plain keywords', 'info'),
  });

  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const { data: ticketList, isFetching } = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => fetchTickets(params),
    // The SLA sweep runs server-side every 60s; poll so meters, breaches,
    // and score bumps show up without a manual refresh.
    refetchInterval: 30_000,
  });
  const ticketRows = ticketList ?? [];

  // Auto-expand the deep-linked ticket once it loads.
  useEffect(() => {
    if (!linkPending || !linkedTicket || !ticketList) return;
    const match = ticketList.find((t) => t.number === linkedTicket);
    if (match) {
      setExpandedId(match.id);
      setLinkPending(false);
    }
  }, [linkPending, linkedTicket, ticketList]);

  // Incoming-ticket watcher: poll the newest tickets regardless of the
  // current view and toast anything that arrived since the last check.
  const { data: latestTickets } = useQuery({
    queryKey: ['latest-tickets'],
    queryFn: () => fetchTickets({ view: 'all', sort: 'newest', limit: 10 }),
    refetchInterval: 15_000,
  });
  const lastSeenId = useRef<number | null>(null);
  useEffect(() => {
    if (!latestTickets?.length) return;
    const maxId = Math.max(...latestTickets.map((t) => t.id));
    if (lastSeenId.current === null) {
      lastSeenId.current = maxId; // baseline on first load — no toast storm
      return;
    }
    const fresh = latestTickets
      .filter((t) => t.id > lastSeenId.current!)
      .sort((a, b) => a.id - b.id);
    lastSeenId.current = Math.max(lastSeenId.current, maxId);
    if (fresh.length > 3) {
      toast(`${fresh.length} new tickets came in`, 'new');
    } else {
      for (const t of fresh) {
        toast(
          `New ticket ${t.number} → ${t.queue.name}: ${t.subject.slice(0, 60)}`,
          'new',
          undefined,
          () => jumpToTicket(t.id, t.number),
        );
      }
    }
  }, [latestTickets]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: ['ticket'] });
  };

  // Jump straight to one ticket: queue page, filters cleared, searched by
  // number, expanded. Used by the incident banner and ticket toasts.
  const jumpToTicket = (id: number, number: string) => {
    setPage('queue');
    setMode('All Tickets');
    setNlFilter(null);
    setAssigneeFilter(undefined);
    setRequesterFilter(undefined);
    setShowSnoozed(false);
    setQueueSel(undefined); // the ticket may live outside your queues
    setSearch(number);
    setJumpedTicket(number);
    setExpandedId(id);
  };

  type UndoOp = { ticketId: number; restore: TicketChanges };

  /** Per-ticket changes that put back what an action is about to overwrite. */
  const restoreFor = (t: TicketListItem, changes: TicketChanges): TicketChanges => {
    const r: TicketChanges = {};
    if ('assigneeId' in changes) r.assigneeId = t.assignee?.id ?? null;
    if ('queueId' in changes) {
      r.queueId = t.queue.id;
      r.assigneeId = t.assignee?.id ?? null; // moving queues can drop the assignee
    }
    if ('statusId' in changes) r.statusId = t.status.id;
    if ('snooze' in changes) r.snooze = null;
    return r;
  };

  const buildUndo = (ids: number[], changes: TicketChanges): UndoOp[] =>
    ids
      .map((id) => {
        const t = ticketRows.find((r) => r.id === id);
        return t ? { ticketId: id, restore: restoreFor(t, changes) } : null;
      })
      .filter((op): op is UndoOp => op !== null && Object.keys(op.restore).length > 0);

  const runUndo = async (ops: UndoOp[]) => {
    for (const op of ops) await patchTicket(op.ticketId, op.restore);
    invalidate();
    toast(`Undone — ${ops.length > 1 ? `${ops.length} tickets` : 'ticket'} restored`, 'info');
  };

  const incidentDemo = useMutation({
    mutationFn: runIncidentDemo,
    onSuccess: (r) => {
      invalidate();
      toast(`🔥 Outage simulated — ${r.filed.join(', ')} filed. SOTO correlates them and the amber banner appears within a few minutes.`, 'info');
    },
    onError: (e: any) => toast(e?.message ?? 'Incident demo failed', 'info'),
  });

  const bulk = useMutation({
    mutationFn: ({ ids, action, changes }: {
      ids: number[]; action: 'update' | 'auto_assign' | 'expertise_assign' | 'mentioned_assign'; changes?: TicketChanges;
      message?: string; undo?: UndoOp[];
    }) => bulkTickets(ids, action, changes),
    onSuccess: (result, vars) => {
      setSelection(new Set());
      invalidate();
      const undoAction = vars.undo?.length ? { label: 'Undo', onClick: () => runUndo(vars.undo!) } : undefined;
      // Single-ticket toasts open that ticket on click.
      const one = vars.ids.length === 1 ? ticketRows.find((t) => t.id === vars.ids[0]) : undefined;
      const openOne = one ? () => jumpToTicket(one.id, one.number) : undefined;
      if (vars.message) toast(vars.message, 'success', undoAction, openOne);
      // A queue move that contradicted the AI just became a labeled
      // correction — say so, that's the learning loop working.
      if (Array.isArray(result) && (result as any[]).some((r) => r?.trained === 'corrected')) {
        toast('✨ Routing correction recorded — future triage learns from this move', 'info');
      }
      else if (vars.action === 'auto_assign' || vars.action === 'expertise_assign' || vars.action === 'mentioned_assign') {
        type AssignResult = { ticketId: number; assigneeId: number | null; assigneeName?: string; fit?: number; via?: string };
        const assigned = (result as AssignResult[]).filter((r) => r.assigneeId != null);
        const verb = vars.action === 'expertise_assign' ? 'Assigned by expertise'
          : vars.action === 'mentioned_assign' ? 'Assigned by mention'
          : 'Auto-assigned';
        const suffix = assigned.length < vars.ids.length
          ? (vars.action === 'expertise_assign' ? ' (rest: no skilled agent available)'
            : vars.action === 'mentioned_assign' ? ' (rest: queue at capacity)'
            : '')
          : '';
        // Expertise/mention picks name the agent so the choice is
        // explainable at a glance (fit % matches the Suggested avatars;
        // mention drops fall back to round-robin when nobody is named).
        const who = (r: AssignResult) => {
          const num = ticketRows.find((t) => t.id === r.ticketId)?.number ?? `#${r.ticketId}`;
          return `${num} → ${r.assigneeName}${r.fit != null ? ` (${Math.round(r.fit * 100)}% fit)` : ''}${r.via === 'round_robin' ? ' (no mention — round-robin)' : ''}`;
        };
        const message =
          vars.action !== 'auto_assign' && assigned.length > 0 && assigned.length <= 3 && assigned[0]?.assigneeName
            ? `${verb}: ${assigned.map(who).join(' · ')}${suffix}`
            : `${verb}: ${assigned.length} of ${vars.ids.length} ticket${vars.ids.length > 1 ? 's' : ''}${suffix}`;
        toast(message, 'success', assigned.length ? undoAction : undefined, openOne);
      }
    },
  });

  const label = (ids: number[]) =>
    ids.length > 1 ? `${ids.length} tickets` : ticketRows.find((t) => t.id === ids[0])?.number ?? 'Ticket';

  const act = (ids: number[], changes: TicketChanges, message?: string) =>
    bulk.mutate({ ids, action: 'update', changes, message, undo: buildUndo(ids, changes) });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const dragTargets = (dragged: number): number[] =>
    selection.has(dragged) ? [...selection] : [dragged];

  function onDragStart(e: DragStartEvent) {
    setDraggingId((e.active.data.current as any)?.ticketId ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const ticketId = (e.active.data.current as any)?.ticketId as number | undefined;
    const target = e.over?.id as string | undefined;
    if (!ticketId || !target) return;
    const ids = dragTargets(ticketId);

    if (target === 'assign-me') act(ids, { assigneeId: userId }, `${label(ids)} assigned to you`);
    else if (target === 'assign-auto') bulk.mutate({ ids, action: 'auto_assign', undo: buildUndo(ids, { assigneeId: null }) });
    else if (target === 'assign-expertise') bulk.mutate({ ids, action: 'expertise_assign', undo: buildUndo(ids, { assigneeId: null }) });
    else if (target === 'assign-mentioned') bulk.mutate({ ids, action: 'mentioned_assign', undo: buildUndo(ids, { assigneeId: null }) });
    else if (target === 'snooze-zone') setSnoozeIds(ids);
    else if (target === 'pin-bar') {
      // Pin, don't mutate: the drop bookmarks the ticket(s) as toolbar tabs.
      const add = ids
        .map((id) => ticketRows.find((r) => r.id === id))
        .filter((t): t is TicketListItem => !!t)
        .map((t) => ({ id: t.id, number: t.number, subject: t.subject }));
      setPinnedTabs((cur) => {
        const merged = [...cur, ...add.filter((a) => !cur.some((p) => p.id === a.id))];
        return merged.slice(-8); // oldest pins roll off
      });
    }
    else if (target.startsWith('agent-')) {
      const agentId = Number(target.slice(6));
      const agent = meta?.agents.find((a) => a.id === agentId);
      if (agent && !agent.isAvailable) {
        toast(`${agent.name} is out of office — ticket not assigned`, 'info');
        return;
      }
      act(ids, { assigneeId: agentId }, `${label(ids)} assigned to ${agent?.name ?? 'agent'}`);
    } else if (target.startsWith('queue-')) {
      const qid = Number(target.slice(6));
      const queue = meta?.queues.find((q) => q.id === qid);
      act(ids, { queueId: qid }, `${label(ids)} moved to ${queue?.name ?? 'queue'}`);
    }
  }

  const resolvedStatus = useMemo(
    () => meta?.statuses.find((s) => s.category === 'resolved'),
    [meta],
  );

  // Queue dropdown ordering: my queues, separator, All queues, rest A→Z.
  const { myQueues, otherQueues } = useMemo(() => {
    const myTeamIds = new Set(meta?.agents.find((a) => a.id === userId)?.teamIds ?? []);
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      myQueues: (meta?.queues ?? []).filter((q) => myTeamIds.has(q.id)).sort(byName),
      otherQueues: (meta?.queues ?? []).filter((q) => !myTeamIds.has(q.id)).sort(byName),
    };
  }, [meta, userId]);

  const draggingCount = draggingId ? dragTargets(draggingId).length : 0;
  const draggingTicket = ticketRows.find((t) => t.id === draggingId);

  const allSelected = ticketRows.length > 0 && ticketRows.every((t) => selection.has(t.id));
  const someSelected = ticketRows.some((t) => selection.has(t.id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const toggleSelectAll = () => {
    setSelection((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        ticketRows.forEach((t) => next.delete(t.id));
        return next;
      }
      return new Set([...prev, ...ticketRows.map((t) => t.id)]);
    });
  };

  const switchUser = (id: number) => {
    setActingUserId(id);
    setUserId(id);
    qc.invalidateQueries();
  };

  // RBAC: requesters get the self-service portal, not the agent board.
  // Everything agent-side is also 403'd server-side for this role.
  if (me?.role === 'requester') {
    return (
      <RequesterPortal
        key={`portal-${userId}`}
        userId={userId}
        onSwitchUser={switchUser}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={cursorFirst}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <header className="menubar">
        <button
          className="logo logo-home"
          title="Back to the queue"
          onClick={() => {
            setPage('queue');
            setMode('All Tickets');
            setQueueSel('mine');
            setAssigneeFilter(undefined);
            setRequesterFilter(undefined);
            setNlFilter(null);
            setSearch('');
            setJumpedTicket(null);
            setShowSnoozed(false);
            // Deep-link params (?ticket=, ?requester=) would re-apply on
            // refresh — going home clears them from the address bar too.
            if (window.location.search) {
              window.history.replaceState(null, '', window.location.pathname);
            }
          }}
        >
          MET<span>S</span>
        </button>
        <nav>
          <a className={page === 'queue' ? 'active' : ''} href="#" onClick={(e) => { e.preventDefault(); setPage('queue'); }}>Queue</a>
          <a className={page === 'dashboards' ? 'active' : ''} href="#" onClick={(e) => { e.preventDefault(); setPage('dashboards'); }}>Dashboards</a>
          <a className={page === 'kb' ? 'active' : ''} href="#" onClick={(e) => { e.preventDefault(); setPage('kb'); }}>Knowledge Base</a>
          <a className={page === 'email' ? 'active' : ''} href="#" onClick={(e) => { e.preventDefault(); setPage('email'); }}>Email</a>
          <a className={page === 'admin' ? 'active' : ''} href="#" onClick={(e) => { e.preventDefault(); setPage('admin'); }}>Admin</a>
        </nav>
        <div className="spacer" />
        <button className="btn accent new-ticket-btn" onClick={() => setNewTicketOpen(true)}>
          + New Ticket
        </button>
        <span className="search-wrap">
          <input
            className="search"
            placeholder="Search… press Enter to ask in plain English"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim().length >= 3 && !nlParse.isPending) {
                nlParse.mutate(search.trim());
              }
            }}
          />
          <button
            className="nl-search-btn"
            title='Ask in plain English — e.g. "open printer tickets in phoenix older than a week"'
            disabled={search.trim().length < 3 || nlParse.isPending}
            onClick={() => nlParse.mutate(search.trim())}
          >
            {nlParse.isPending ? '…' : '✨'}
          </button>
        </span>
        {isEntra ? (
          <span className="sso-user">
            {me?.name ?? '…'}
            <button className="btn ghost" title="Sign out" onClick={() => signOut()}>Sign out</button>
          </span>
        ) : (
        <select
          className="user-switcher"
          title="Acting as (dev auth)"
          value={userId}
          onChange={(e) => switchUser(Number(e.target.value))}
        >
          {directory ? (
            <>
              <optgroup label="Staff">
                {directory.filter((u) => u.role !== 'requester')
                  .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
              <optgroup label="Requesters">
                {directory.filter((u) => u.role === 'requester')
                  .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            </>
          ) : (
            meta?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)
          )}
        </select>
        )}
        <NotificationsBell key={userId} />
        <button
          className="theme-toggle"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
      </header>

      <IncidentBanner onOpen={(i) => jumpToTicket(i.id, i.number)} />

      {page === 'dashboards' && <Dashboard />}
      {page === 'kb' && <KnowledgeBase />}
      {page === 'email' && <EmailSimulator />}
      {page === 'admin' && <Admin />}

      {page === 'queue' && (<>
      <div className="modebar">
        {MODES.map((m) => (
          <button
            key={m}
            className={m === mode ? (m === 'AI Triage' ? 'active accent' : 'active') : ''}
            onClick={() => { setMode(m); setShowSnoozed(false); setAssigneeFilter(undefined); setRequesterFilter(undefined); }}
          >
            {m}
          </button>
        ))}
        <button
          className="incident-demo-btn"
          disabled={incidentDemo.isPending}
          title="Simulate an outage: three similar tickets are filed and SOTO declares a suspected incident within a few minutes"
          onClick={() => incidentDemo.mutate()}
        >
          {incidentDemo.isPending ? 'Filing…' : '⚠️ Incident Demo'}
        </button>
        {assigneeFilter && (
          <span className="filter-chip">
            Assigned: {meta?.agents.find((a) => a.id === assigneeFilter)?.name ?? `#${assigneeFilter}`}
            <button onClick={() => setAssigneeFilter(undefined)} title="Clear filter">✕</button>
          </span>
        )}
        {requesterFilter && (
          <span className="filter-chip">
            Submitted by: {meta?.agents.find((a) => a.id === requesterFilter)?.name ?? `user #${requesterFilter}`}
            <button
              onClick={() => {
                setRequesterFilter(undefined);
                const q = new URLSearchParams(window.location.search);
                if (q.has('requester')) {
                  q.delete('requester');
                  window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}`);
                }
              }}
              title="Clear filter"
            >✕</button>
          </span>
        )}
        {nlFilter && (
          <span className="filter-chip nl-chip" title={nlFilter.interpretation}>
            ✨ {nlFilter.interpretation}
            <button onClick={() => setNlFilter(null)} title="Clear AI search">✕</button>
          </span>
        )}
        <PinDropZone dragging={draggingId != null}>
          {pinnedTabs.map((p) => (
            <span key={p.id} className="pin-tab" title={p.subject}>
              <button className="pin-tab-open" onClick={() => jumpToTicket(p.id, p.number)}>
                {p.number}
              </button>
              <button
                className="pin-tab-close"
                title="Unpin"
                onClick={() => setPinnedTabs((cur) => cur.filter((x) => x.id !== p.id))}
              >✕</button>
            </span>
          ))}
          {draggingId != null && <span className="pin-cue">📌 drop here to pin</span>}
          {draggingId == null && pinnedTabs.length === 0 && (
            <span className="mode-hint">
              {mode === 'All Tickets' && 'Drag tickets onto an agent (left), a queue (right), or up here to pin'}
              {mode === 'Unassigned' && (queueSel === 'mine'
                ? 'Open tickets with no assignee in your queues'
                : 'Open tickets with no assignee')}
              {mode === 'Assigned Tickets' && 'Your assigned tickets'}
              {mode === 'Closed' && 'Resolved and closed tickets — reopen by changing status'}
              {mode === 'AI Triage' && 'AI categorization, routing, and priority checks — accept or dismiss'}
            </span>
          )}
        </PinDropZone>
        <span className="spacer" />
        <label className="toolbar-field">
          Queue
          <select
            value={queueSel ?? ''}
            onChange={(e) => setQueueSel(
              e.target.value === 'mine' ? 'mine'
              : e.target.value ? Number(e.target.value)
              : undefined,
            )}
          >
            <option value="mine">My queues ({myQueues.reduce((n, q) => n + q.openCount, 0)})</option>
            <option value="">All queues</option>
            {myQueues.length > 0 && <option disabled>────────────</option>}
            {myQueues.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.openCount})</option>)}
            {myQueues.length > 0 && otherQueues.length > 0 && <option disabled>────────────</option>}
            {otherQueues.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.openCount})</option>)}
          </select>
        </label>
        <label className="toolbar-field">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="toolbar-check">
          <input type="checkbox" checked={showSnoozed} onChange={(e) => setShowSnoozed(e.target.checked)} />
          Snoozed
        </label>
      </div>

      <WelcomeCard />

      <div className="board">
        {leftCollapsed && !draggingId ? (
          <button className="rail-strip" onClick={() => setLeftCollapsed(false)} title="Expand the agents rail">
            <span className="rail-strip-chevron">»</span>
            <span className="rail-strip-label">Agents</span>
          </button>
        ) : (
          <AgentRail
            meta={meta}
            queueId={queueId}
            assigneeFilter={assigneeFilter}
            onSelectAssignee={(id) => { setAssigneeFilter(id); if (id && mode !== 'All Tickets') setMode('All Tickets'); }}
            onCollapse={leftCollapsed ? undefined : () => setLeftCollapsed(true)}
          />
        )}
        {mode === 'AI Triage' ? (
          <main className="queue-list">
            <TriagePanel />
          </main>
        ) : (
        <main className="queue-list">
          {selection.size > 0 && (
            <BulkBar
              count={selection.size}
              meta={meta}
              onAssignMe={() => act([...selection], { assigneeId: userId })}
              onAutoAssign={() => bulk.mutate({ ids: [...selection], action: 'auto_assign', undo: buildUndo([...selection], { assigneeId: null }) })}
              onMove={(qid) => act([...selection], { queueId: qid })}
              onSnooze={() => setSnoozeIds([...selection])}
              onClose={() => resolvedStatus && act([...selection], { statusId: resolvedStatus.id }, `Resolved ${selection.size} ticket${selection.size > 1 ? 's' : ''}`)}
              onClear={() => setSelection(new Set())}
            />
          )}
          <div className="list-header" title="Select all tickets in this view">
            <span />
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              title={`Select all (${ticketRows.length})`}
            />
            <span className="col-type">Type</span>
            <span>Ticket</span>
            <span className="col-sent" title="Sentiment read by AI (boosts or docks the score)" />
            <span>Subject</span>
            <span className="col-tags">Tags</span>
            <span className="col-queue">Queue · Cat.</span>
            <span className="col-requester">Requester</span>
            <span className="col-pri" title="Priority">Pri</span>
            <span className="col-right col-score">Score</span>
            <span className="col-right col-age">Age</span>
            <span>SLA</span>
            <span className="col-status">Status</span>
            <span className="col-agt" title="Assignee">Agt</span>
          </div>
          <div className={`ticket-list ${isFetching ? 'fetching' : ''}`}>
            {ticketRows.map((t) => (
              <TicketRow
                key={t.id}
                ticket={t}
                selected={selection.has(t.id)}
                expanded={expandedId === t.id}
                onToggleSelect={(id) => {
                  setSelection((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  });
                }}
                onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              />
            ))}
            {ticketRows.length === 0 && !isFetching && (
              <div className="empty">No tickets match this view.</div>
            )}
          </div>
        </main>
        )}
        {rightCollapsed && !draggingId ? (
          <button className="rail-strip" onClick={() => setRightCollapsed(false)} title="Expand the actions rail">
            <span className="rail-strip-chevron">«</span>
            <span className="rail-strip-label">Actions & Queues</span>
          </button>
        ) : (
          <ActionRail
            mode={mode}
            meta={meta}
            queueId={queueId}
            onSelectQueue={(id) => setQueueSel(id ?? 'mine')}
            onCollapse={rightCollapsed ? undefined : () => setRightCollapsed(true)}
          />
        )}
      </div>
      </>)}

      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]} style={{ width: 'max-content', height: 'auto' }}>
        {draggingId && (
          <div className="drag-ghost">
            {draggingCount > 1
              ? `${draggingCount} tickets`
              : `${draggingTicket?.number ?? ''} · ${draggingTicket?.subject ?? ''}`}
          </div>
        )}
      </DragOverlay>

      <Toasts />
      <ChatDrawer key={`chat-${userId}`} />

      {newTicketOpen && <NewTicketDialog onClose={() => setNewTicketOpen(false)} />}

      {snoozeIds && (
        <SnoozeDialog
          count={snoozeIds.length}
          onCancel={() => setSnoozeIds(null)}
          onConfirm={(until, reason) => {
            act(snoozeIds, { snooze: { until, reason } }, `Snoozed ${label(snoozeIds)}`);
            setSnoozeIds(null);
          }}
        />
      )}
    </DndContext>
  );
}
