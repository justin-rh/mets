import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptEnrichment, correctEnrichment, dismissEnrichment, fetchDecisions,
  fetchMeta, fetchTriage, runTriage, type AiDecision, type TriageSuggestion,
} from '../api';

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function confClass(v: number) {
  return v >= 0.8 ? 'conf-high' : v >= 0.5 ? 'conf-mid' : 'conf-low';
}

/** Pick the right category/queue/priority — the labeled correction. */
function CorrectionForm({ enrichmentId, onDone, onCancel }: {
  enrichmentId: number; onDone: () => void; onCancel: () => void;
}) {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [categoryId, setCategoryId] = useState('');
  const [queueId, setQueueId] = useState('');
  const [priority, setPriority] = useState('');
  const correct = useMutation({
    mutationFn: () => correctEnrichment(enrichmentId, {
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      ...(queueId ? { queueId: Number(queueId) } : {}),
      ...(priority ? { priority: Number(priority) } : {}),
    }),
    onSuccess: onDone,
  });
  return (
    <div className="correction-form">
      <span className="correction-label">Correct to:</span>
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">category…</option>
        {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
        <option value="">queue…</option>
        {meta?.queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
      </select>
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="">priority…</option>
        {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
      </select>
      <button
        className="btn primary"
        disabled={(!categoryId && !queueId && !priority) || correct.isPending}
        onClick={() => correct.mutate()}
      >
        Apply & teach
      </button>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function SuggestionCard({ s, onDone }: { s: TriageSuggestion; onDone: () => void }) {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [correcting, setCorrecting] = useState(false);
  const r = s.enrichment.result;
  const suggestedQueue = meta?.queues.find((q) => q.slug === r.queueSlug);

  const accept = useMutation({ mutationFn: () => acceptEnrichment(s.enrichment.id), onSuccess: onDone });
  const dismiss = useMutation({ mutationFn: () => dismissEnrichment(s.enrichment.id), onSuccess: onDone });

  const categoryChanged = r.category !== (s.categoryName ?? '');
  const queueChanged = suggestedQueue && suggestedQueue.id !== s.ticket.queueId;
  const priorityChanged = r.priority !== s.ticket.priority;

  return (
    <div className="triage-card">
      <div className="triage-head">
        <span className="ticket-number">{s.ticket.number}</span>
        <span className="triage-subject" title={s.ticket.subject}>{s.ticket.subject}</span>
        <span className="ticket-requester">{s.requesterName}</span>
      </div>
      <p className="triage-summary">{r.summary}</p>
      {r.reasoning && (
        <p className="ai-reasoning" title="Why the AI chose this routing">💡 {r.reasoning}</p>
      )}
      <div className="triage-suggestions">
        <span className={`suggestion ${confClass(r.confidence.category)} ${categoryChanged ? '' : 'unchanged'}`}>
          {categoryChanged ? `${s.categoryName ?? 'Uncategorized'} → ${r.category}` : `Category: ${r.category} ✓`}
          <em>{pct(r.confidence.category)}</em>
        </span>
        <span className={`suggestion ${confClass(r.confidence.queue)} ${queueChanged ? '' : 'unchanged'}`}>
          {queueChanged ? `${s.queueName} → ${suggestedQueue?.name}` : `Queue: ${s.queueName} ✓`}
          <em>{pct(r.confidence.queue)}</em>
        </span>
        <span className={`suggestion ${confClass(r.confidence.priority)} ${priorityChanged ? '' : 'unchanged'}`}>
          {priorityChanged ? `P${s.ticket.priority} → P${r.priority}` : `Priority: P${r.priority} ✓`}
          <em>{pct(r.confidence.priority)}</em>
        </span>
        {r.sentiment !== 'neutral' && <span className="suggestion sentiment">{r.sentiment}</span>}
      </div>
      {correcting ? (
        <CorrectionForm enrichmentId={s.enrichment.id} onDone={onDone} onCancel={() => setCorrecting(false)} />
      ) : (
        <div className="triage-actions">
          <button className="btn accent" disabled={accept.isPending} onClick={() => accept.mutate()}>Accept</button>
          <button className="btn" onClick={() => setCorrecting(true)}>Correct…</button>
          <button className="btn ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  auto_applied: { label: 'auto-applied', cls: 'outcome-auto' },
  applied: { label: 'accepted', cls: 'outcome-accepted' },
  pending: { label: 'pending review', cls: 'outcome-pending' },
  dismissed: { label: 'dismissed', cls: 'outcome-dismissed' },
  corrected: { label: 'corrected', cls: 'outcome-corrected' },
};

function DecisionRow({ d, onDone }: { d: AiDecision; onDone: () => void }) {
  const [correcting, setCorrecting] = useState(false);
  const r = d.enrichment.result;
  const outcome = OUTCOME_LABEL[d.enrichment.status] ?? { label: d.enrichment.status, cls: '' };
  const corrected = d.enrichment.feedback?.corrected;
  const minConf = Math.min(r.confidence.category, r.confidence.queue, r.confidence.priority);

  return (
    <div className="decision-row">
      <div className="decision-main">
        <span className="ticket-number">{d.ticket.number}</span>
        <span className="decision-subject" title={d.ticket.subject}>{d.ticket.subject}</span>
        <span
          className={`suggestion ${confClass(minConf)}`}
          title={r.reasoning ? `💡 ${r.reasoning}` : 'AI classification (lowest field confidence)'}
        >
          {r.category} → {r.queueSlug} · P{r.priority} <em>{pct(minConf)}</em>
        </span>
        <span className={`outcome ${outcome.cls}`}>
          {outcome.label}
          {corrected && (
            <em title="What the agent corrected it to">
              {' '}→ {[corrected.category, corrected.queueSlug, corrected.priority && `P${corrected.priority}`].filter(Boolean).join(' · ')}
            </em>
          )}
        </span>
        {(d.enrichment.status === 'auto_applied' || d.enrichment.status === 'applied') && !correcting && (
          <button className="btn ghost decision-flag" onClick={() => setCorrecting(true)}>⚑ Flag & correct</button>
        )}
      </div>
      {correcting && (
        <CorrectionForm enrichmentId={d.enrichment.id} onDone={() => { setCorrecting(false); onDone(); }} onCancel={() => setCorrecting(false)} />
      )}
    </div>
  );
}

export function TriagePanel() {
  const qc = useQueryClient();
  const { data: suggestions, isFetching } = useQuery({ queryKey: ['triage'], queryFn: fetchTriage });
  const { data: log } = useQuery({ queryKey: ['ai-decisions'], queryFn: fetchDecisions, refetchInterval: 30_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['triage'] });
    qc.invalidateQueries({ queryKey: ['ai-decisions'] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };

  const run = useMutation({ mutationFn: () => runTriage(10), onSuccess: invalidate });

  const acceptAllHigh = useMutation({
    mutationFn: async () => {
      const high = (suggestions ?? []).filter(
        (s) => s.enrichment.result.confidence.category >= 0.8 && s.enrichment.result.confidence.queue >= 0.8,
      );
      for (const s of high) await acceptEnrichment(s.enrichment.id);
    },
    onSuccess: invalidate,
  });

  const highCount = (suggestions ?? []).filter(
    (s) => s.enrichment.result.confidence.category >= 0.8 && s.enrichment.result.confidence.queue >= 0.8,
  ).length;

  const stats = log?.stats;
  const agreed = stats ? Number(stats.auto_applied) + Number(stats.accepted) : 0;
  const judged = stats ? agreed + Number(stats.corrected) + Number(stats.dismissed) : 0;

  return (
    <div className="triage-panel">
      <div className="triage-toolbar">
        <button className="btn accent" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Claude is triaging…' : '✨ Run AI Triage (10 tickets)'}
        </button>
        {highCount > 0 && (
          <button className="btn" disabled={acceptAllHigh.isPending} onClick={() => acceptAllHigh.mutate()}>
            Accept all high-confidence ({highCount})
          </button>
        )}
        {stats && judged > 0 && (
          <span className="triage-stats" title="Last 30 days">
            <strong>{Math.round((agreed / judged) * 100)}% agreement</strong>
            {Number(stats.total) > 0 && <> · {Math.round((Number(stats.auto_applied) / Number(stats.total)) * 100)}% fully automatic</>}
            {' · '}{stats.auto_applied} auto · {stats.accepted} accepted · {stats.corrected} corrected · {stats.dismissed} dismissed
          </span>
        )}
      </div>

      {run.isPending && <div className="triage-working">Analyzing tickets with Claude — a few seconds per ticket…</div>}

      <div className="rail-title">Needs review — accept, correct, or dismiss</div>
      <div className="triage-list">
        {(suggestions ?? []).map((s) => (
          <SuggestionCard key={s.enrichment.id} s={s} onDone={invalidate} />
        ))}
        {!isFetching && !run.isPending && (suggestions ?? []).length === 0 && (
          <div className="empty">No pending AI suggestions. Run AI Triage to analyze untriaged open tickets.</div>
        )}
      </div>

      <div className="rail-title">
        AI decision log — every routing decision; flag anything wrong and it becomes a pattern the AI follows
      </div>
      <div className="decision-list">
        {(log?.decisions ?? []).map((d) => (
          <DecisionRow key={d.enrichment.id} d={d} onDone={invalidate} />
        ))}
        {(log?.decisions ?? []).length === 0 && (
          <div className="empty">No AI decisions yet — create a ticket or run triage.</div>
        )}
      </div>
    </div>
  );
}
