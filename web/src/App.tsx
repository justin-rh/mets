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
  actingUserId, bulkTickets, fetchMeta, fetchTickets, setActingUserId,
  type ListParams, type TicketChanges,
} from './api';
import { MODES, type Mode } from './board';
import { Admin } from './components/Admin';
import { BulkBar } from './components/BulkBar';
import { Dashboard } from './components/Dashboard';
import { EmailSimulator } from './components/EmailSimulator';
import { KnowledgeBase } from './components/KnowledgeBase';
import { NewTicketDialog } from './components/NewTicketDialog';
import { ActionRail, AgentRail } from './components/Rail';
import { SnoozeDialog } from './components/SnoozeDialog';
import { TicketRow } from './components/TicketRow';
import { TriagePanel } from './components/TriagePanel';
import './App.css';

const SORTS = ['date', 'score', 'priority', 'requester', 'description', 'random'] as const;

export default function App() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('All Tickets');
  const [sort, setSort] = useState<string>('score');
  const [queueId, setQueueId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [snoozeIds, setSnoozeIds] = useState<number[] | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [page, setPage] = useState<'queue' | 'dashboards' | 'kb' | 'email' | 'admin'>('queue');
  const [userId, setUserId] = useState(actingUserId());
  const [theme, setTheme] = useState(() => localStorage.getItem('mets-theme') ?? 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mets-theme', theme);
  }, [theme]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const view = showSnoozed ? 'snoozed'
    : mode === 'My Queue' ? 'mine'
    : mode === 'Unassigned' ? 'unassigned'
    : mode === 'My Categories' ? 'my_queues'
    : 'open';
  const params = { view: view as ListParams['view'], queueId, sort, search: debouncedSearch };

  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const { data: ticketList, isFetching } = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => fetchTickets(params),
    // The SLA sweep runs server-side every 60s; poll so meters, breaches,
    // and score bumps show up without a manual refresh.
    refetchInterval: 30_000,
  });
  const ticketRows = ticketList ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: ['ticket'] });
  };

  const bulk = useMutation({
    mutationFn: ({ ids, action, changes }: { ids: number[]; action: 'update' | 'auto_assign'; changes?: TicketChanges }) =>
      bulkTickets(ids, action, changes),
    onSuccess: () => { setSelection(new Set()); invalidate(); },
  });

  const act = (ids: number[], changes: TicketChanges) => bulk.mutate({ ids, action: 'update', changes });

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

    if (target === 'assign-me') act(ids, { assigneeId: userId });
    else if (target === 'assign-auto') bulk.mutate({ ids, action: 'auto_assign' });
    else if (target === 'snooze-zone') setSnoozeIds(ids);
    else if (target.startsWith('agent-')) act(ids, { assigneeId: Number(target.slice(6)) });
    else if (target.startsWith('queue-')) act(ids, { queueId: Number(target.slice(6)) });
  }

  const resolvedStatus = useMemo(
    () => meta?.statuses.find((s) => s.category === 'resolved'),
    [meta],
  );

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

  return (
    <DndContext sensors={sensors} collisionDetection={cursorFirst} onDragStart={onDragStart} onDragEnd={onDragEnd}>
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
          onChange={(e) => {
            const id = Number(e.target.value);
            setActingUserId(id);
            setUserId(id);
            qc.invalidateQueries();
          }}
        >
          {meta?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
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
            onClick={() => { setMode(m); setShowSnoozed(false); }}
          >
            {m}
          </button>
        ))}
        <span className="mode-hint">
          {mode === 'All Tickets' && 'Drag tickets onto an agent (left) or a queue (right)'}
          {mode === 'Unassigned' && 'Open tickets with no assignee'}
          {mode === 'My Categories' && 'Tickets in the queues your teams own'}
          {mode === 'My Queue' && 'Your assigned tickets'}
          {mode === 'AI Triage' && 'AI categorization, routing, and priority checks — accept or dismiss'}
        </span>
        <span className="spacer" />
        <label className="toolbar-field">
          Queue
          <select value={queueId ?? ''} onChange={(e) => setQueueId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All queues</option>
            {meta?.queues.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.openCount})</option>)}
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
        <AgentRail meta={meta} queueId={queueId} mode={mode} />
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
              onAutoAssign={() => bulk.mutate({ ids: [...selection], action: 'auto_assign' })}
              onMove={(qid) => act([...selection], { queueId: qid })}
              onSnooze={() => setSnoozeIds([...selection])}
              onClose={() => resolvedStatus && act([...selection], { statusId: resolvedStatus.id })}
              onClear={() => setSelection(new Set())}
            />
          )}
          <div className="list-header">
            <span className="list-header-spacer" />
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              title="Select all tickets in this view"
            />
            <span className="list-header-label">
              {selection.size > 0 ? `${selection.size} selected` : `Select all (${ticketRows.length})`}
            </span>
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
        <ActionRail mode={mode} meta={meta} queueId={queueId} onSelectQueue={setQueueId} />
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

      {newTicketOpen && <NewTicketDialog onClose={() => setNewTicketOpen(false)} />}

      {snoozeIds && (
        <SnoozeDialog
          count={snoozeIds.length}
          onCancel={() => setSnoozeIds(null)}
          onConfirm={(until, reason) => {
            act(snoozeIds, { snooze: { until, reason } });
            setSnoozeIds(null);
          }}
        />
      )}
    </DndContext>
  );
}
