import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addAgentSkill, addRoutingRule, addStatus, deleteRoutingRule,
  fetchAdminConfig, fetchMeta, removeAgentSkill, renameStatus,
  saveAiThresholds, saveScoreWeights, saveSlaPolicy, syncSkills,
  toggleRoutingRule, type AdminConfig,
} from '../api';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };
}

function ScoreWeightsCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [w, setW] = useState(config.scoreWeights);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setW(config.scoreWeights), [config.scoreWeights]);
  const save = useMutation({
    mutationFn: () => saveScoreWeights(w!),
    onSuccess: (r: any) => { setSaved(`Saved — ${r.rescored} open tickets rescored instantly`); invalidate(); },
  });
  if (!w) return null;
  const num = (label: string, value: number, set: (v: number) => void) => (
    <label className="admin-field" key={label}>
      {label}
      <input type="number" value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  return (
    <div className="admin-card">
      <h3>Ticket score weights</h3>
      <p className="admin-hint">The queue sorts by these. Saving rescores every open ticket — no deployment.</p>
      <div className="admin-fields">
        {(['1', '2', '3', '4'] as const).map((p) =>
          num(`P${p} weight`, w.priority[p] ?? 0, (v) => setW({ ...w, priority: { ...w.priority, [p]: v } })),
        )}
        {num('Per business day open', w.agePerBusinessDay, (v) => setW({ ...w, agePerBusinessDay: v }))}
        {num('Age cap', w.ageCap, (v) => setW({ ...w, ageCap: v }))}
        {num('VIP requester', w.vip, (v) => setW({ ...w, vip: v }))}
        {num('SLA warning', w.slaWarning, (v) => setW({ ...w, slaWarning: v }))}
        {num('SLA breached', w.slaBreached, (v) => setW({ ...w, slaBreached: v }))}
      </div>
      <div className="admin-actions">
        <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Rescoring…' : 'Save & rescore'}
        </button>
        {saved && <span className="admin-saved">{saved}</span>}
      </div>
    </div>
  );
}

function SlaCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [rows, setRows] = useState(config.slaPolicies);
  const [saved, setSaved] = useState(false);
  useEffect(() => setRows(config.slaPolicies), [config.slaPolicies]);
  const save = useMutation({
    mutationFn: async () => {
      for (const r of rows) await saveSlaPolicy(r.id, { firstResponseMinutes: r.firstResponseMinutes, resolutionMinutes: r.resolutionMinutes });
    },
    onSuccess: () => { setSaved(true); invalidate(); },
  });
  return (
    <div className="admin-card">
      <h3>SLA policies</h3>
      <p className="admin-hint">Business minutes (Mon–Fri 8–17 Phoenix). Applies to newly created tickets.</p>
      <table className="admin-table">
        <thead><tr><th>Policy</th><th>First response</th><th>Resolution</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><input type="number" value={r.firstResponseMinutes ?? 0}
                onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, firstResponseMinutes: Number(e.target.value) } : x))} /></td>
              <td><input type="number" value={r.resolutionMinutes ?? 0}
                onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, resolutionMinutes: Number(e.target.value) } : x))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-actions">
        <button className="btn primary" disabled={save.isPending} onClick={() => { setSaved(false); save.mutate(); }}>Save policies</button>
        {saved && <span className="admin-saved">Saved</span>}
      </div>
    </div>
  );
}

function AiCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [t, setT] = useState(config.aiThresholds);
  const [saved, setSaved] = useState(false);
  useEffect(() => setT(config.aiThresholds), [config.aiThresholds]);
  const save = useMutation({ mutationFn: () => saveAiThresholds(t), onSuccess: () => { setSaved(true); invalidate(); } });
  return (
    <div className="admin-card">
      <h3>AI confidence gates</h3>
      <p className="admin-hint">
        At or above <strong>auto-apply</strong>, AI changes apply (audited, revertible).
        Between the gates it's a one-click suggestion; below <strong>suggest</strong> it stays untouched.
      </p>
      <div className="admin-fields">
        <label className="admin-field">Auto-apply ≥
          <input type="number" step="0.05" min="0" max="1" value={t.autoApply}
            onChange={(e) => setT({ ...t, autoApply: Number(e.target.value) })} />
        </label>
        <label className="admin-field">Suggest ≥
          <input type="number" step="0.05" min="0" max="1" value={t.suggest}
            onChange={(e) => setT({ ...t, suggest: Number(e.target.value) })} />
        </label>
      </div>
      <div className="admin-actions">
        <button className="btn primary" disabled={save.isPending} onClick={() => { setSaved(false); save.mutate(); }}>Save gates</button>
        {saved && <span className="admin-saved">Saved</span>}
      </div>
    </div>
  );
}

function StatusesCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('pending');
  const add = useMutation({
    mutationFn: () => addStatus({ name, category }),
    onSuccess: () => { setName(''); invalidate(); },
  });
  const rename = useMutation({
    mutationFn: ({ id, newName }: { id: number; newName: string }) => renameStatus(id, newName),
    onSuccess: invalidate,
  });
  return (
    <div className="admin-card">
      <h3>Statuses</h3>
      <p className="admin-hint">
        Add statuses freely — SLA pause, reopen, and reporting key off the
        five fixed categories, so new statuses need zero engine changes.
        <em> pending</em> pauses SLA clocks.
      </p>
      <div className="admin-status-list">
        {config.statuses.map((s) => (
          <span key={s.id} className="admin-status" title="Double-click to rename"
            onDoubleClick={() => {
              const newName = prompt('Rename status', s.name);
              if (newName?.trim()) rename.mutate({ id: s.id, newName: newName.trim() });
            }}>
            {s.name} <em>{s.category}</em>
          </span>
        ))}
      </div>
      <div className="admin-inline-form">
        <input placeholder="New status name (e.g. Waiting on Parts)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {['new', 'open', 'pending', 'resolved', 'closed'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Add status</button>
      </div>
    </div>
  );
}

function RulesCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [name, setName] = useState('');
  const [field, setField] = useState('subject');
  const [value, setValue] = useState('');
  const [queue, setQueue] = useState('');
  const [minPriority, setMinPriority] = useState('');

  const add = useMutation({
    mutationFn: () => addRoutingRule({
      name,
      condition: { field, op: 'contains', value },
      actions: {
        ...(queue ? { setQueue: queue } : {}),
        ...(minPriority ? { minPriority: Number(minPriority) } : {}),
      },
    }),
    onSuccess: () => { setName(''); setValue(''); setQueue(''); setMinPriority(''); invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => toggleRoutingRule(id, enabled),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => deleteRoutingRule(id), onSuccess: invalidate });

  const summarize = (r: AdminConfig['routingRules'][number]) => {
    const cond = (r.conditions as any).any?.[0] ?? (r.conditions as any).all?.[0];
    const a = r.actions as any;
    const parts = [];
    if (a.setQueue) parts.push(`→ ${a.setQueue}`);
    if (a.minPriority) parts.push(`min P${a.minPriority}`);
    if (a.addTags?.length) parts.push(`+${a.addTags.join(',')}`);
    return `${cond?.field ?? '?'} ${cond?.op ?? ''} "${cond?.value ?? ''}" ${parts.join(' · ')}`;
  };

  return (
    <div className="admin-card admin-card-wide">
      <h3>Routing rules</h3>
      <p className="admin-hint">
        Evaluated in order on every new ticket, first match wins. Every firing
        is logged to the ticket's audit trail.
      </p>
      <div className="admin-rule-list">
        {config.routingRules.map((r) => (
          <div key={r.id} className={`admin-rule ${r.enabled ? '' : 'disabled'}`}>
            <label className="admin-rule-toggle">
              <input type="checkbox" checked={r.enabled}
                onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })} />
            </label>
            <span className="admin-rule-pos">{r.position}</span>
            <span className="admin-rule-name">{r.name}</span>
            <span className="admin-rule-summary">{summarize(r)}</span>
            <button className="btn ghost" onClick={() => remove.mutate(r.id)}>✕</button>
          </div>
        ))}
      </div>
      <div className="admin-inline-form">
        <input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 180 }} />
        <select value={field} onChange={(e) => setField(e.target.value)}>
          <option value="subject">subject</option>
          <option value="description">description</option>
          <option value="requester.department">requester dept</option>
        </select>
        <span className="admin-hint">contains</span>
        <input placeholder="text…" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 130 }} />
        <select value={queue} onChange={(e) => setQueue(e.target.value)}>
          <option value="">→ queue (optional)</option>
          {meta?.queues.map((q) => <option key={q.slug} value={q.slug}>{q.name}</option>)}
        </select>
        <select value={minPriority} onChange={(e) => setMinPriority(e.target.value)}>
          <option value="">min priority (opt.)</option>
          {[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}
        </select>
        <button className="btn" disabled={name.trim().length < 3 || !value.trim() || add.isPending} onClick={() => add.mutate()}>
          Add rule
        </button>
      </div>
    </div>
  );
}

function ExpertiseCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const [agentId, setAgentId] = useState<number | ''>('');
  const [skillName, setSkillName] = useState('');
  const [level, setLevel] = useState('2');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const agent = meta?.agents.find((a) => a.id === agentId);

  const add = useMutation({
    mutationFn: () => addAgentSkill(agentId as number, skillName.trim(), Number(level)),
    onSuccess: () => { setSkillName(''); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (skillId: number) => removeAgentSkill(agentId as number, skillId),
    onSuccess: invalidate,
  });
  const sync = useMutation({
    mutationFn: syncSkills,
    onSuccess: (r) => { setSyncMsg(`Recomputed from history — ${r.qualified} qualified, ${r.revoked} revoked`); invalidate(); },
  });

  return (
    <div className="admin-card">
      <h3>Agent expertise</h3>
      <p className="admin-hint">
        Skills drive Assign-by-Expertise. <strong>auto</strong> = earned from
        resolution history (≥5 resolved in a category, releveled at 10 and 20,
        re-synced every 6h); <strong>manual</strong> = assigned here and never
        touched by the sync.
      </p>
      <div className="admin-inline-form" style={{ marginBottom: 10 }}>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choose an agent…</option>
          {meta?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn" disabled={sync.isPending} onClick={() => { setSyncMsg(null); sync.mutate(); }}>
          {sync.isPending ? 'Recomputing…' : 'Recompute from history'}
        </button>
        {syncMsg && <span className="admin-saved">{syncMsg}</span>}
      </div>
      {agent && (
        <>
          <div className="admin-status-list">
            {agent.skills.map((s) => (
              <span key={s.id} className="admin-status">
                {s.name} · L{s.level} <em>{s.source}</em>
                <button className="skill-remove" title="Remove skill" onClick={() => remove.mutate(s.id)}>✕</button>
              </span>
            ))}
            {agent.skills.length === 0 && <span className="admin-hint">No skills yet.</span>}
          </div>
          <div className="admin-inline-form">
            <input
              list="skill-catalog"
              placeholder="Skill (pick or type new)"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
            />
            <datalist id="skill-catalog">
              {config.skills.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {[1, 2, 3].map((l) => <option key={l} value={l}>L{l}</option>)}
            </select>
            <button className="btn" disabled={skillName.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>
              Add skill
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Admin() {
  const { data: config, error } = useQuery({ queryKey: ['admin'], queryFn: fetchAdminConfig, retry: false });
  if (error) {
    return <div className="admin"><div className="empty">Admin requires the admin role — switch to Justin Rhoda in the user picker.</div></div>;
  }
  if (!config) return <div className="admin"><div className="empty">Loading…</div></div>;
  return (
    <div className="admin">
      <div className="admin-grid">
        <ScoreWeightsCard config={config} />
        <SlaCard config={config} />
        <AiCard config={config} />
        <StatusesCard config={config} />
        <ExpertiseCard config={config} />
        <RulesCard config={config} />
      </div>
    </div>
  );
}
