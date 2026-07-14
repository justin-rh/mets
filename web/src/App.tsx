import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection,
  useSensor, useSensors,
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
  patchTicket, setActingUserId, type ListParams, type TicketChanges,
  type TicketListItem,
} from './api';
import { RequesterPortal } from './components/RequesterPortal';
import { MODES, type Mode } from './board';
import { Admin } from './components/Admin';
import { BulkBar } from './components/BulkBar';
import { Dashboard } from './components/Dashboard';
import { EmailSimulator } from './components/EmailSimulator';
import { KnowledgeBase } from './components/KnowledgeBase';
import { NewTicketDialog } from './components/NewTicketDialog';
import { NotificationsBell } from './components/NotificationsBell';
import { ActionRail, AgentRail } from './components/Rail';
import { SnoozeDialog } from './components/SnoozeDialog';
import { TicketRow } from './components/TicketRow';
import { toast, Toasts } from './components/Toasts';
import { ChatDrawer } from './components/ChatDrawer';
import { TriagePanel } from './components/TriagePanel';
import './App.css';

const SORTS = ['date', 'score', 'priority', 'requester', 'description', 'random'] as const;

export default function App() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('All Tickets');
  const [sort, setSort] = useState<string>('score');
  const [queueId, setQueueId] = useState<number | undefined>();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('ticket') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Deep link: /?ticket=T-1000042 seeds the search and auto-expands the match.
  const [linkedTicket] = useState(() => new URLSearchParams(window.location.search).get('ticket'));
  const [linkPending, setLinkPending] = useState(() => !!linkedTicket);
  // Agent filters: assigned queue (from clicking an agent card) and
  // submitted-by (from /?requester=<id>, opened in a new tab).
  const [assigneeFilter, setAssigneeFilter] = useState<number | undefined>();
  const [requesterFilter, setRequesterFilter] = useState<number | undefined>(() => {
    const v = new URLSearchParams(window.location.search).get('requester');
    return v ? Number(v) : undefined;
  });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [snoozeIds, setSnoozeIds] = useState<number[] | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [page, setPage] = useState<'queue' | 'dashboards' | 'kb' | 'email' | 'admin'>('queue');
  const [userId, setUserId] = useState(actingUserId());
  const [theme, setTheme] = useState(() => localStorage.getItem('mets-theme') ?? 'light');
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
    : requesterFilter ? 'all' // submitted-by view spans open and closed
    : showSnoozed ? 'snoozed'
    : mode === 'My Queue' ? 'mine'
    : mode === 'Unassigned' ? 'unassigned'
    : mode === 'My Categories' ? 'my_queues'
    : mode === 'Closed' ? 'closed'
    : 'open';
  const params = { view, queueId, assigneeId: assigneeFilter, requesterId: requesterFilter, sort, search: debouncedSearch };

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
        toast(`New ticket ${t.number} → ${t.queue.name}: ${t.subject.slice(0, 60)}`, 'new');
      }
    }
  }, [latestTickets]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: ['ticket'] });
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

  const bulk = useMutation({
    mutationFn: ({ ids, action, changes }: {
      ids: number[]; action: 'update' | 'auto_assign' | 'expertise_assign'; changes?: TicketChanges;
      message?: string; undo?: UndoOp[];
    }) => bulkTickets(ids, action, changes),
    onSuccess: (result, vars) => {
      setSelection(new Set());
      invalidate();
      const undoAction = vars.undo?.length ? { label: 'Undo', onClick: () => runUndo(vars.undo!) } : undefined;
      if (vars.message) toast(vars.message, 'success', undoAction);
      else if (vars.action === 'auto_assign' || vars.action === 'expertise_assign') {
        const assigned = (result as { assigneeId: number | null }[]).filter((r) => r.assigneeId != null);
        const verb = vars.action === 'expertise_assign' ? 'Assigned by expertise' : 'Auto-assigned';
        const suffix = vars.action === 'expertise_assign' && assigned.length < vars.ids.length
          ? ' (rest: no skilled agent available)' : '';
        toast(
          `${verb}: ${assigned.length} of ${vars.ids.length} ticket${vars.ids.length > 1 ? 's' : ''}${suffix}`,
          'success',
          assigned.length ? undoAction : undefined,
        );
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
    else if (target === 'snooze-zone') setSnoozeIds(ids);
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
        <div className="logo">MET<span>S</span></div>
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
        <input
          className="search"
          placeholder="Search tickets… (T-1000042, subject)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        <NotificationsBell key={userId} />
        <button
          className="theme-toggle"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
      </header>

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
        {assigneeFilter && (
          <span className="filter-chip">
            Assigned: {meta?.agents.find((a) => a.id === assigneeFilter)?.name ?? `#${assigneeFilter}`}
            <button onClick={() => setAssigneeFilter(undefined)} title="Clear filter">✕</button>
          </span>
        )}
        {requesterFilter && (
          <span className="filter-chip">
            Submitted by: {meta?.agents.find((a) => a.id === requesterFilter)?.name ?? `user #${requesterFilter}`}
            <button onClick={() => setRequesterFilter(undefined)} title="Clear filter">✕</button>
          </span>
        )}
        <span className="mode-hint">
          {mode === 'All Tickets' && 'Drag tickets onto an agent (left) or a queue (right)'}
          {mode === 'Unassigned' && 'Open tickets with no assignee'}
          {mode === 'My Categories' && 'Tickets in the queues your teams own'}
          {mode === 'My Queue' && 'Your assigned tickets'}
          {mode === 'Closed' && 'Resolved and closed tickets — reopen by changing status'}
          {mode === 'AI Triage' && 'AI categorization, routing, and priority checks — accept or dismiss'}
        </span>
        <span className="spacer" />
        <label className="toolbar-field">
          Queue
          <select value={queueId ?? ''} onChange={(e) => setQueueId(e.target.value ? Number(e.target.value) : undefined)}>
            {myQueues.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.openCount})</option>)}
            {myQueues.length > 0 && <option disabled>────────────</option>}
            <option value="">All queues</option>
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
            mode={mode}
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
            onSelectQueue={setQueueId}
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
