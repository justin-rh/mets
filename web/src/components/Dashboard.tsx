import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard, type DashboardData } from '../api';

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
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

  return (
    <div className="dashboard">
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
      </div>

      <VolumeChart daily={data.daily} />

      <div className="chart-grid">
        <HBars title="Open backlog by age" rows={backlog} />
        <HBars title="Open tickets by queue" rows={data.openByQueue.map((q) => ({ label: q.name, value: Number(q.count) }))} />
        <HBars
          title="Ticket Points — last 30 days"
          rows={data.leaderboard.map((l) => ({ label: l.name, value: Number(l.tp), sub: `${l.resolved} resolved` }))}
        />
        <HBars
          title="CSAT distribution — 30d"
          rows={[5, 4, 3, 2, 1].map((r) => ({
            label: '★'.repeat(r),
            value: Number(data.csatDist.find((d) => Number(d.rating) === r)?.count ?? 0),
          }))}
        />
      </div>
    </div>
  );
}
