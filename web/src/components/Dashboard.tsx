import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDashboard, fetchDigest, fetchLeaderboard, generateDigest, type DashboardData } from '../api';
import { initials } from '../format';

const MEDALS = ['🥇', '🥈', '🥉'];
const RANGES = [
  { days: 7, label: 'Week' },
  { days: 30, label: 'Month' },
  { days: 90, label: 'Quarter' },
];

function Leaderboard() {
  const [days, setDays] = useState(30);
  const { data } = useQuery({
    queryKey: ['leaderboard', days],
    queryFn: () => fetchLeaderboard(days),
    refetchInterval: 60_000,
  });
  const rows = data?.rows ?? [];
  const maxTp = Math.max(1, ...rows.map((r) => Number(r.tp)));
  const fmtH = (v: number | null) =>
    v == null ? '—' : v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`;

  return (
    <div className="chart-card leaderboard-card">
      <div className="chart-head">
        <h3>TP Leaderboard — Ticket Points earned</h3>
        <span className="lb-ranges">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`lb-range ${days === r.days ? 'active' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </span>
      </div>
      <table className="lb-table">
        <thead>
          <tr>
            <th className="lb-rank" />
            <th>Agent</th>
            <th className="lb-num">TP</th>
            <th />
            <th className="lb-num">Resolved</th>
            <th className="lb-num" title="Resolution SLAs met">SLA</th>
            <th className="lb-num" title="Median first response">First resp.</th>
            <th className="lb-num" title="Average requester rating">CSAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={i < 3 ? 'lb-podium' : ''}>
              <td className="lb-rank">{MEDALS[i] ?? i + 1}</td>
              <td className="lb-agent">
                <span className="avatar">{initials(r.name)}</span>
                {r.name}
              </td>
              <td className="lb-num lb-tp">{r.tp}</td>
              <td className="lb-bar-cell">
                <span className="lb-bar" style={{ width: `${Math.round((Number(r.tp) / maxTp) * 100)}%` }} />
              </td>
              <td className="lb-num">{r.resolved}</td>
              <td className="lb-num">{r.sla_pct != null ? `${r.sla_pct}%` : '—'}</td>
              <td className="lb-num">{fmtH(r.median_frt_hours)}</td>
              <td className="lb-num">{r.csat != null ? `${r.csat}★` : '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="lb-empty">No resolutions in this window yet.</td></tr>
          )}
        </tbody>
      </table>
      <p className="lb-hint">
        TP = the score of every ticket an agent resolved: harder, older, higher-priority
        tickets are worth more. The quality columns keep it honest.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

const FINDING_ICON: Record<string, { icon: string; label: string }> = {
  problem: { icon: '🔁', label: 'Recurring problem' },
  trend: { icon: '📈', label: 'Trend' },
  kb_gap: { icon: '📚', label: 'KB gap' },
  ops: { icon: '⏱', label: 'Operations' },
};

/** SOTO's weekly briefing — problem patterns across weeks, not days. */
function DigestCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['digest'], queryFn: fetchDigest, staleTime: 300_000 });
  const regen = useMutation({
    mutationFn: generateDigest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest'] }),
  });
  const d = data?.digest;

  return (
    <div className="chart-card digest-card">
      <div className="chart-head">
        <h3>✨ SOTO's weekly briefing</h3>
        <span className="digest-meta">
          {d ? `${new Date(d.generatedAt).toLocaleDateString()} · last ${d.periodDays} days` : ''}
          <button className="btn ghost" disabled={regen.isPending} onClick={() => regen.mutate()}>
            {regen.isPending ? 'Analyzing…' : d ? 'Regenerate' : 'Generate now'}
          </button>
        </span>
      </div>
      {!d && !regen.isPending && (
        <p className="digest-empty">No briefing yet — it generates automatically every week, or click Generate now.</p>
      )}
      {d && (
        <>
          <p className="digest-headline">{d.result.headline}</p>
          <div className="digest-findings">
            {d.result.findings.map((f, i) => {
              const k = FINDING_ICON[f.kind] ?? FINDING_ICON.ops!;
              return (
                <div key={i} className="digest-finding">
                  <span className="digest-kind" title={k.label}>{k.icon}</span>
                  <div>
                    <strong>{f.title}</strong>
                    <p>{f.detail}</p>
                    <p className="digest-action">→ {f.suggestedAction}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Opus 4.8 list pricing — the honest cost line under the accuracy numbers.
const PRICE_IN_PER_M = 5, PRICE_OUT_PER_M = 25;

/** How AI triage is actually performing — from the audited decision log. */
function AiScoreboard({ ai }: { ai: DashboardData['ai'] }) {
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const t = ai.tiles;
  const judged = n(t.auto_30) + n(t.accepted_30) + n(t.corrected_30) + n(t.dismissed_30);
  const agreed = n(t.auto_30) + n(t.accepted_30);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
  const accuracy = pct(agreed, judged);
  const autoRate = pct(n(t.auto_30), n(t.total_30));
  const wk = pct(n(t.agreed_wk), n(t.judged_wk));
  const prev = pct(n(t.agreed_prev), n(t.judged_prev));
  const delta = wk != null && prev != null ? wk - prev : null;

  const inputTok = ai.usage.reduce((s, u) => s + n(u.input_tokens), 0);
  const outputTok = ai.usage.reduce((s, u) => s + n(u.output_tokens), 0);
  const calls = ai.usage.reduce((s, u) => s + n(u.calls), 0);
  const cost = (inputTok / 1e6) * PRICE_IN_PER_M + (outputTok / 1e6) * PRICE_OUT_PER_M;

  if (n(t.total_30) === 0) return null;
  return (
    <>
      <div className="tiles ai-tiles">
        <Tile
          label="✨ AI routing accuracy"
          value={accuracy != null ? `${accuracy}%` : '—'}
          sub={`${agreed} of ${judged} judged decisions confirmed, 30d`}
        />
        <Tile
          label="Fully automatic"
          value={autoRate != null ? `${autoRate}%` : '—'}
          sub={`${t.auto_30} of ${t.total_30} routed with no human touch`}
        />
        <Tile
          label="Corrections"
          value={String(t.corrected_30)}
          sub="each one becomes a routing pattern the AI follows"
        />
        <Tile
          label="This week vs last"
          value={wk != null ? `${wk}%${delta != null ? ` ${delta > 0 ? '▲' : delta < 0 ? '▼' : '·'}` : ''}` : '—'}
          sub={prev != null ? `${prev}% last week` : 'not enough decisions yet'}
        />
        <Tile
          label="AI spend · 30d"
          value={`$${cost.toFixed(2)}`}
          sub={`${calls} calls · ${((inputTok + outputTok) / 1000).toFixed(0)}k tokens · list pricing, no cache discounts`}
        />
      </div>
      <div className="chart-grid">
        <HBars
          title="AI decisions by category — 30d (accuracy)"
          rows={ai.byCategory.map((c) => ({
            label: `${c.category} · ${pct(n(c.decisions) - n(c.corrected), n(c.decisions))}%`,
            value: n(c.decisions),
          }))}
        />
        <HBars
          title="AI usage by feature — 30d (tokens)"
          rows={ai.usage.map((u) => {
            const featureCost = (n(u.input_tokens) / 1e6) * PRICE_IN_PER_M + (n(u.output_tokens) / 1e6) * PRICE_OUT_PER_M;
            const perCall = n(u.calls) > 0 ? featureCost / n(u.calls) : 0;
            const perCallLabel = perCall < 0.095 ? `${(perCall * 100).toFixed(1)}¢` : `$${perCall.toFixed(2)}`;
            return {
              label: `${u.feature} (${u.calls} calls)`,
              value: n(u.input_tokens) + n(u.output_tokens),
              sub: `~${perCallLabel}/call`,
            };
          })}
        />
      </div>
    </>
  );
}

/** Two-series line chart (created vs resolved) with crosshair tooltip. */
function VolumeChart({ daily }: { daily: DashboardData['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 180, PAD = { l: 30, r: 10, t: 10, b: 22 };
  const pts = daily.map((d) => ({ day: d.day, created: Number(d.created), resolved: Number(d.resolved) }));
  const max = Math.max(1, ...pts.flatMap((p) => [p.created, p.resolved]));
  const x = (i: number) => PAD.l + (i / Math.max(1, pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const path = (key: 'created' | 'resolved') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = useMemo(() => [0, Math.round(max / 2), max], [max]);
  const h = hover != null ? pts[hover] : null;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>Tickets per day — last 30 days</h3>
        <span className="legend">
          <i className="swatch s1" /> Created
          <i className="swatch s2" /> Resolved
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="volume-chart"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1));
          setHover(Math.max(0, Math.min(pts.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="gridline" />
            <text x={PAD.l - 6} y={y(t) + 3} className="axis-label" textAnchor="end">{t}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="axis-label">{pts[0]?.day.slice(5)}</text>
        <text x={W - PAD.r} y={H - 6} className="axis-label" textAnchor="end">{pts[pts.length - 1]?.day.slice(5)}</text>
        <path d={path('created')} className="line l1" />
        <path d={path('resolved')} className="line l2" />
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
            <circle cx={x(hover)} cy={y(h.created)} r={4} className="dot d1" />
            <circle cx={x(hover)} cy={y(h.resolved)} r={4} className="dot d2" />
          </g>
        )}
      </svg>
      <div className="chart-tooltip">
        {h ? `${h.day} — created ${h.created} · resolved ${h.resolved}` : ' '}
      </div>
    </div>
  );
}

/** Horizontal bars with direct labels — single hue, value in text ink. */
function HBars({ title, rows }: { title: string; rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="chart-card">
      <div className="chart-head"><h3>{title}</h3></div>
      <div className="hbars">
        {rows.map((r) => (
          <div key={r.label} className="hbar-row" title={`${r.label}: ${r.value}${r.sub ? ` (${r.sub})` : ''}`}>
            <span className="hbar-label">{r.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="hbar-value">{r.value}{r.sub ? ` · ${r.sub}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BUCKET_ORDER = ['< 1d', '1–3d', '3–7d', '7–30d', '> 30d'];

export function Dashboard() {
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, refetchInterval: 60_000 });
  if (!data) return <div className="dashboard"><div className="empty">Loading dashboards…</div></div>;

  const t = data.tiles;
  const fmtH = (v: number | null) => (v == null ? '—' : v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`);
  const backlog = BUCKET_ORDER
    .map((b) => ({ label: b, value: Number(data.backlogAge.find((r) => r.bucket === b)?.count ?? 0) }));

  // The business case in one line: what the AI did vs what it cost.
  const nn = (v: string | number | null | undefined) => Number(v ?? 0);
  const aiCost = data.ai.usage.reduce(
    (s, u) => s + (nn(u.input_tokens) / 1e6) * PRICE_IN_PER_M + (nn(u.output_tokens) / 1e6) * PRICE_OUT_PER_M,
    0,
  );
  const autoRouted = nn(data.ai.tiles.auto_30);

  return (
    <div className="dashboard">
      {autoRouted > 0 && (
        <p className="dashboard-headline">
          ✨ Last 30 days: <strong>{autoRouted} tickets</strong> routed hands-free
          {nn(t.deflected_30) > 0 && (
            <> · <strong>{t.deflected_30}</strong> resolved with no agent at all</>
          )}
          {' '}· total AI spend <strong>${aiCost.toFixed(2)}</strong>
        </p>
      )}
      <div className="tiles">
        <Tile label="Open tickets" value={t.open_count} />
        <Tile label="Created · 30d" value={t.created_30} />
        <Tile label="Resolved · 30d" value={t.resolved_30} />
        <Tile label="Median resolution" value={fmtH(t.median_mttr_hours)} sub="30d, median not mean" />
        <Tile label="Median first response" value={fmtH(t.median_frt_hours)} sub="30d" />
        <Tile label="SLA attainment" value={t.sla_attainment_pct ? `${t.sla_attainment_pct}%` : '—'} sub="resolution SLAs met, 30d" />
        <Tile
          label="CSAT"
          value={t.csat_avg_30 ? `${Number(t.csat_avg_30).toFixed(1)} ★` : '—'}
          sub={`${t.csat_count_30} ratings, 30d`}
        />
        <Tile
          label="✨ Self-service deflections"
          value={t.deflected_30 ?? 0}
          sub={`of ${t.deflection_offered_30 ?? 0} KB fixes offered, 30d — closed without an agent`}
        />
      </div>

      <DigestCard />

      <AiScoreboard ai={data.ai} />

      <VolumeChart daily={data.daily} />

      <div className="chart-grid">
        <HBars title="Open backlog by age" rows={backlog} />
        <HBars title="Open tickets by queue" rows={data.openByQueue.map((q) => ({ label: q.name, value: Number(q.count) }))} />
        <HBars
          title="CSAT distribution — 30d"
          rows={[5, 4, 3, 2, 1].map((r) => ({
            label: '★'.repeat(r),
            value: Number(data.csatDist.find((d) => Number(d.rating) === r)?.count ?? 0),
          }))}
        />
      </div>

      <Leaderboard />
    </div>
  );
}
