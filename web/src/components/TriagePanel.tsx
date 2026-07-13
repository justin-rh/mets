import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptEnrichment, dismissEnrichment, fetchMeta, fetchTriage, runTriage, type TriageSuggestion } from '../api';

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function confClass(v: number) {
  return v >= 0.8 ? 'conf-high' : v >= 0.5 ? 'conf-mid' : 'conf-low';
}

function SuggestionCard({ s, onDone }: { s: TriageSuggestion; onDone: () => void }) {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
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
      <div className="triage-actions">
        <button className="btn accent" disabled={accept.isPending} onClick={() => accept.mutate()}>
          Accept
        </button>
        <button className="btn ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function TriagePanel() {
  const qc = useQueryClient();
  const { data: suggestions, isFetching } = useQuery({ queryKey: ['triage'], queryFn: fetchTriage });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['triage'] });
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
        <span className="mode-hint">
          Suggestions ≥80% confident on both category and queue count as high-confidence.
          Accept/dismiss decisions train the thresholds.
        </span>
      </div>

      {run.isPending && <div className="triage-working">Analyzing tickets with Claude — a few seconds per ticket…</div>}

      <div className="triage-list">
        {(suggestions ?? []).map((s) => (
          <SuggestionCard key={s.enrichment.id} s={s} onDone={invalidate} />
        ))}
        {!isFetching && !run.isPending && (suggestions ?? []).length === 0 && (
          <div className="empty">
            No pending AI suggestions. Run AI Triage to analyze untriaged open tickets.
          </div>
        )}
      </div>
    </div>
  );
}
