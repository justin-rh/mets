import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addAgentSkill, addRecurring, addRoutingRule, addStatus, addTemplate,
  deleteRecurring, deleteRoutingRule, deleteTemplate, fetchAdminConfig,
  fetchAdminUsers, fetchMeta, importPreview, importRun, removeAgentSkill,
  renameStatus, runEscalationSweep,
  updateUserLead, updateUserQueues, updateUserRole,
  type ImportPreview, type ImportResult,
  saveAiThresholds, saveAutoClose, saveEscalation, saveQueueNotify,
  saveScoreKeywords, saveScoreWeights, saveSlaPolicy, setCategoryApproval,
  syncSkills, toggleRecurring, toggleRoutingRule, updateTemplate,
  type AdminConfig,
} from '../api';
import { actingUserId } from '../board';

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
        {num('😤 Frustrated requester', (w as any).sentimentFrustrated ?? 10, (v) => setW({ ...w, sentimentFrustrated: v } as any))}
        {num('⚡ Urgent tone', (w as any).sentimentUrgent ?? 5, (v) => setW({ ...w, sentimentUrgent: v } as any))}
        {num('🔇 ALL-CAPS penalty', (w as any).allCapsPenalty ?? 10, (v) => setW({ ...w, allCapsPenalty: v } as any))}
      </div>
      <p className="admin-hint">
        Sentiment comes from AI triage. The ALL-CAPS penalty <em>subtracts</em> —
        shouting does not make a ticket more urgent here.
      </p>
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
  const [autoCloseDays, setAutoCloseDays] = useState(config.autoClose.days);
  const [saved, setSaved] = useState(false);
  useEffect(() => setRows(config.slaPolicies), [config.slaPolicies]);
  useEffect(() => setAutoCloseDays(config.autoClose.days), [config.autoClose.days]);
  const save = useMutation({
    mutationFn: async () => {
      for (const r of rows) await saveSlaPolicy(r.id, { firstResponseMinutes: r.firstResponseMinutes, resolutionMinutes: r.resolutionMinutes });
      if (autoCloseDays !== config.autoClose.days) await saveAutoClose(autoCloseDays);
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
      <label className="admin-field admin-autoclose">
        Auto-close resolved tickets after
        <span className="admin-autoclose-input">
          <input
            type="number"
            min={0}
            max={90}
            value={autoCloseDays}
            onChange={(e) => setAutoCloseDays(Number(e.target.value))}
          />
          days <em>(0 disables; a requester reply reopens)</em>
        </span>
      </label>
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

function KeywordsCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [term, setTerm] = useState('');
  const [boost, setBoost] = useState('15');
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (keywords: AdminConfig['scoreKeywords']) => saveScoreKeywords(keywords),
    onSuccess: (r) => { setSaved(`Saved — ${r.rescored} open tickets rescored`); invalidate(); },
  });
  const add = () => {
    setSaved(null);
    save.mutate([...config.scoreKeywords, { term: term.trim().toLowerCase(), boost: Number(boost) }]);
    setTerm('');
  };
  const remove = (t: string) => {
    setSaved(null);
    save.mutate(config.scoreKeywords.filter((k) => k.term !== t));
  };

  return (
    <div className="admin-card">
      <h3>Flag keywords</h3>
      <p className="admin-hint">
        Tickets whose subject or description contains a keyword get flagged 🚩
        in the queue and boosted by the given score. Case-insensitive; changes
        rescore every open ticket instantly.
      </p>
      <div className="admin-status-list">
        {config.scoreKeywords.map((k) => (
          <span key={k.term} className="admin-status">
            🚩 {k.term} <em>+{k.boost}</em>
            <button className="skill-remove" title="Remove keyword" onClick={() => remove(k.term)}>✕</button>
          </span>
        ))}
        {config.scoreKeywords.length === 0 && <span className="admin-hint">No keywords yet.</span>}
      </div>
      <div className="admin-inline-form">
        <input
          placeholder="Keyword (e.g. outage)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && term.trim().length >= 2) add(); }}
        />
        <input type="number" value={boost} onChange={(e) => setBoost(e.target.value)} style={{ width: 64 }} title="Score boost" />
        <button
          className="btn"
          disabled={term.trim().length < 2 || save.isPending
            || config.scoreKeywords.some((k) => k.term === term.trim().toLowerCase())}
          onClick={add}
        >
          Add
        </button>
        {saved && <span className="admin-saved">{saved}</span>}
      </div>
    </div>
  );
}

function RecurringCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('request');
  const [frequency, setFrequency] = useState('monthly');
  const [firstRun, setFirstRun] = useState('');

  const add = useMutation({
    mutationFn: () => addRecurring({
      name: name.trim(), subject: subject.trim(), description: description.trim(),
      type, frequency, firstRunAt: new Date(`${firstRun}T08:00:00`).toISOString(),
    }),
    onSuccess: () => {
      setName(''); setSubject(''); setDescription(''); setFirstRun('');
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => toggleRecurring(id, enabled),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => deleteRecurring(id), onSuccess: invalidate });

  return (
    <div className="admin-card admin-card-wide">
      <h3>Recurring tickets</h3>
      <p className="admin-hint">
        Scheduled work — preventive maintenance, cert renewals, access
        reviews. When a schedule comes due (checked every 5 minutes) a real
        ticket is filed through the normal pipeline: routing rules, SLA,
        AI triage. Filed under your name; tickets wake at 8:00.
      </p>
      <div className="admin-rule-list">
        {config.recurring.map((r) => (
          <div key={r.id} className={`admin-rule ${r.enabled ? '' : 'disabled'}`}>
            <label className="admin-rule-toggle" title={r.enabled ? 'Enabled' : 'Paused'}>
              <input type="checkbox" checked={r.enabled}
                onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })} />
            </label>
            <span className="admin-rule-name">{r.name}</span>
            <span className="admin-rule-summary">
              {r.frequency} · next {new Date(r.nextRunAt).toLocaleDateString()}
              {r.lastRunAt ? ` · last ${new Date(r.lastRunAt).toLocaleDateString()}` : ''} — "{r.subject}"
            </span>
            <button className="btn ghost" onClick={() => remove.mutate(r.id)}>✕</button>
          </div>
        ))}
        {config.recurring.length === 0 && <span className="admin-hint">No schedules yet.</span>}
      </div>
      <div className="admin-inline-form" style={{ flexWrap: 'wrap' }}>
        <input placeholder="Schedule name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 170 }} />
        <input placeholder="Ticket subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: 220 }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="request">Request</option>
          <option value="incident">Incident</option>
          <option value="change">Change</option>
        </select>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
        <input type="date" value={firstRun} onChange={(e) => setFirstRun(e.target.value)} title="First run date" />
        <textarea
          placeholder="Ticket description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ flexBasis: '100%' }}
        />
        <button
          className="btn"
          disabled={name.trim().length < 3 || subject.trim().length < 3 || !description.trim() || !firstRun || add.isPending}
          onClick={() => add.mutate()}
        >
          Add schedule
        </button>
      </div>
    </div>
  );
}

function QueueNotifyCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savedId, setSavedId] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: ({ id, emails }: { id: number; emails: string | null }) => saveQueueNotify(id, emails),
    onSuccess: (_r, v) => { setSavedId(v.id); invalidate(); },
  });

  const valueFor = (q: AdminConfig['queueNotifications'][number]) =>
    drafts[q.id] ?? q.notifyEmails ?? '';

  return (
    <div className="admin-card admin-card-wide">
      <h3>Queue email notifications</h3>
      <p className="admin-hint">
        Every ticket that <strong>enters</strong> a queue (created, routed,
        AI-moved, or dragged) emails these addresses — once per ticket per
        queue. Comma-separate multiple. Best for low-volume, high-stakes
        queues; subscribing the intake queue means email for nearly every ticket.
      </p>
      <div className="qnotify-list">
        {config.queueNotifications.map((q) => (
          <div key={q.id} className={`qnotify-row ${q.notifyEmails ? 'configured' : ''}`}>
            <span className="qnotify-name">{q.notifyEmails ? '📧' : ''} {q.name}</span>
            <input
              placeholder="none — add addresses to notify"
              value={valueFor(q)}
              onChange={(e) => { setSavedId(null); setDrafts({ ...drafts, [q.id]: e.target.value }); }}
            />
            <button
              className="btn"
              disabled={save.isPending || valueFor(q) === (q.notifyEmails ?? '')}
              onClick={() => save.mutate({ id: q.id, emails: valueFor(q).trim() || null })}
            >
              {savedId === q.id ? '✓' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EscalationCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [cfg, setCfg] = useState(config.escalation);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setCfg(config.escalation), [config.escalation]);

  const save = useMutation({
    mutationFn: () => saveEscalation(cfg),
    onSuccess: () => { setSaved('Saved — sweep runs every 5 minutes'); invalidate(); },
  });
  const run = useMutation({
    mutationFn: runEscalationSweep,
    onSuccess: (r) => {
      setSaved(r.escalated === 0
        ? 'Sweep ran — nothing stale (or escalation is disabled)'
        : `Escalated ${r.escalated}: ${r.byExpertise} by expertise, ${r.roundRobin} round-robin${r.unfilled ? `, ${r.unfilled} unfilled` : ''} — queue leads pinged in chat`);
      invalidate();
    },
  });

  return (
    <div className="admin-card">
      <h3>Escalation — stale unassigned tickets</h3>
      <p className="admin-hint">
        Tickets unassigned past their priority's threshold get auto-assigned:
        score ≥ the threshold below goes <strong>by expertise</strong> (best
        person), the rest round-robin (fastest hands). Queue leads get a SOTO
        Bot chat summary. Each ticket escalates once, audited.
      </p>
      <label className="flag-option" style={{ marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
        />
        <span>Enabled<em>off by default — flipping this works the whole stale backlog</em></span>
      </label>
      <div className="admin-fields">
        {(['1', '2', '3', '4'] as const).map((p) => (
          <label className="admin-field" key={p}>
            P{p} after (min)
            <input
              type="number"
              min={1}
              value={cfg.minutesByPriority[p] ?? 0}
              onChange={(e) => setCfg({
                ...cfg,
                minutesByPriority: { ...cfg.minutesByPriority, [p]: Number(e.target.value) },
              })}
            />
          </label>
        ))}
        <label className="admin-field">
          Expertise if score ≥
          <input
            type="number"
            min={0}
            value={cfg.expertiseScoreThreshold}
            onChange={(e) => setCfg({ ...cfg, expertiseScoreThreshold: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="admin-actions">
        <button className="btn primary" disabled={save.isPending} onClick={() => { setSaved(null); save.mutate(); }}>
          Save
        </button>
        <button className="btn" disabled={run.isPending} onClick={() => { setSaved(null); run.mutate(); }}>
          {run.isPending ? 'Sweeping…' : 'Run sweep now'}
        </button>
        {saved && <span className="admin-saved">{saved}</span>}
      </div>
    </div>
  );
}

function ApprovalGatesCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const toggle = useMutation({
    mutationFn: ({ id, requiresApproval }: { id: number; requiresApproval: boolean }) =>
      setCategoryApproval(id, requiresApproval),
    onSuccess: invalidate,
  });
  return (
    <div className="admin-card">
      <h3>Approval gates</h3>
      <p className="admin-hint">
        Request-type tickets landing in a checked category park at intake in
        “Awaiting Approval” (SLA paused) and go to the requester's manager —
        approving routes them on to the queue triage picked; rejecting resolves
        them with the reason.
      </p>
      <div className="approval-gate-list">
        {config.categories.map((c) => (
          <label key={c.id} className={`approval-gate ${c.requiresApproval ? 'gated' : ''}`}>
            <input
              type="checkbox"
              checked={c.requiresApproval}
              onChange={(e) => toggle.mutate({ id: c.id, requiresApproval: e.target.checked })}
            />
            {c.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function TemplatesCard({ config }: { config: AdminConfig }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [autoRespond, setAutoRespond] = useState(false);

  const add = useMutation({
    mutationFn: () => addTemplate({
      name: name.trim(), body: body.trim(),
      categoryId: categoryId ? Number(categoryId) : null,
      autoRespond,
    }),
    onSuccess: () => { setName(''); setBody(''); setCategoryId(''); setAutoRespond(false); invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updateTemplate(id, { isActive }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => deleteTemplate(id), onSuccess: invalidate });

  const catName = (id: number | null) => config.categories.find((c) => c.id === id)?.name;

  return (
    <div className="admin-card admin-card-wide">
      <h3>Response templates & auto-respond</h3>
      <p className="admin-hint">
        Canned replies with variables: {'{{requester.firstName}}, {{ticket.number}}, {{ticket.subject}}, {{queue.name}}, {{category.name}}, {{agent.name}}'}.
        Templates marked <strong>auto</strong> post as <strong title="Sorts Out Tickets, Obviously">SOTO Bot</strong>{' '}
        (<em>Sorts Out Tickets, Obviously</em>): no category = acknowledgment on
        every new ticket; with a category = auto-reply when a ticket lands there (counts as first response).
      </p>
      <div className="admin-rule-list">
        {config.templates.map((t) => (
          <div key={t.id} className={`admin-rule ${t.isActive ? '' : 'disabled'}`}>
            <label className="admin-rule-toggle" title={t.isActive ? 'Active' : 'Inactive'}>
              <input type="checkbox" checked={t.isActive}
                onChange={(e) => toggle.mutate({ id: t.id, isActive: e.target.checked })} />
            </label>
            <span className="admin-rule-name">{t.name}</span>
            <span className="admin-rule-summary" title={t.body}>
              {t.autoRespond ? `⚡ auto · ${catName(t.categoryId) ?? 'every new ticket'}` : catName(t.categoryId) ?? 'general'}
              {' — '}{t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body}
            </span>
            <button className="btn ghost" onClick={() => remove.mutate(t.id)}>✕</button>
          </div>
        ))}
      </div>
      <div className="admin-inline-form" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 190 }} />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Category (optional)</option>
          {config.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="admin-rule-toggle" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={autoRespond} onChange={(e) => setAutoRespond(e.target.checked)} />
          ⚡ auto-respond
        </label>
        <textarea
          placeholder="Body… use {{requester.firstName}}, {{ticket.number}}, etc."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          style={{ flexBasis: '100%' }}
        />
        <button className="btn" disabled={name.trim().length < 3 || body.trim().length < 10 || add.isPending} onClick={() => add.mutate()}>
          Add template
        </button>
      </div>
    </div>
  );
}

/** Queue membership + visibility per staff user. */
function UserQueuesCard(_: { config: AdminConfig }) {
  const qc = useQueryClient();
  const { data: staff } = useQuery({ queryKey: ['admin-users'], queryFn: fetchAdminUsers });
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  const save = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { teamIds?: number[]; queueVisibility?: 'all' | 'own' } }) =>
      updateUserQueues(id, body),
    onSuccess: invalidate,
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: 'admin' | 'agent' | 'readonly' }) => updateUserRole(id, role),
    onSuccess: invalidate,
  });
  const setLead = useMutation({
    mutationFn: ({ id, teamId, lead }: { id: number; teamId: number; lead: boolean }) => updateUserLead(id, teamId, lead),
    onSuccess: invalidate,
  });

  if (!staff || !meta) return <div className="admin-card"><div className="empty">Loading…</div></div>;
  const queueName = new Map(meta.queues.map((q) => [q.id, q.name]));
  const me = actingUserId();

  return (
    <div className="admin-card admin-card-wide">
      <h3>Users & Queues</h3>
      <p className="admin-hint">
        Role sets what a user can do (readonly = view only). Membership
        drives assignment, the My-queues scope, and the agent rail; the ★
        makes someone lead of that queue — leads can mark teammates out of
        office and get escalation pings. Visibility set to <em>only their
        queues</em> hides everything else, enforced server-side.
      </p>
      <div className="uq-list">
        {staff.map((u) => {
          const memberQueues = u.teamIds.map((id) => ({ id, name: queueName.get(id) ?? `#${id}` }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const addable = meta.queues.filter((q) => !u.teamIds.includes(q.id))
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div key={u.id} className="uq-row">
              <span className="uq-user">
                <strong>{u.name}</strong>
                <select
                  className="uq-role"
                  value={u.role}
                  disabled={u.id === me}
                  title={u.id === me ? "You can't change your own role" : 'Role'}
                  onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as any })}
                >
                  <option value="admin">admin</option>
                  <option value="agent">agent</option>
                  <option value="readonly">readonly</option>
                </select>
              </span>
              <span className="uq-queues">
                {memberQueues.map((q) => {
                  const isLead = u.leadTeamIds.includes(q.id);
                  return (
                  <span key={q.id} className={`uq-chip ${isLead ? 'uq-chip-lead' : ''}`}>
                    <button
                      className={`uq-lead ${isLead ? 'on' : ''}`}
                      title={isLead ? `Remove ${u.name.split(' ')[0]} as lead of ${q.name}` : `Make ${u.name.split(' ')[0]} lead of ${q.name}`}
                      onClick={() => setLead.mutate({ id: u.id, teamId: q.id, lead: !isLead })}
                    >{isLead ? '★' : '☆'}</button>
                    {q.name}
                    <button
                      title={`Remove ${u.name.split(' ')[0]} from ${q.name}`}
                      onClick={() => save.mutate({ id: u.id, body: { teamIds: u.teamIds.filter((t) => t !== q.id) } })}
                    >✕</button>
                  </span>
                  );
                })}
                {memberQueues.length === 0 && <span className="uq-none">no queues</span>}
                <select
                  className="uq-add"
                  value=""
                  title="Add a queue"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    save.mutate({ id: u.id, body: { teamIds: [...u.teamIds, Number(e.target.value)] } });
                  }}
                >
                  <option value="">+ queue…</option>
                  {addable.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </span>
              <select
                className="uq-vis"
                value={u.queueVisibility}
                title="Which queues this user can see on the board"
                onChange={(e) => save.mutate({ id: u.id, body: { queueVisibility: e.target.value as 'all' | 'own' } })}
              >
                <option value="all">Sees all queues</option>
                <option value="own">Only their queues</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const IMPORT_FIELD_LABELS: [string, string][] = [
  ['legacyNumber', 'Original number'],
  ['subject', 'Subject'],
  ['description', 'Description'],
  ['requester', 'Caller / requester'],
  ['state', 'State'],
  ['priority', 'Priority'],
  ['createdAt', 'Opened at'],
  ['resolvedAt', 'Resolved at'],
  ['closedAt', 'Closed at'],
  ['queue', 'Assignment group'],
  ['notes', 'Work notes'],
];

/** ServiceNow migration: upload → mapping preview (the dry run) → import. */
function ImportCard(_: { config: AdminConfig }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [runTriage, setRunTriage] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => importPreview(file),
    onSuccess: (p) => { setPreview(p); setMapping(p.mapping); setResult(null); setError(null); },
    onError: (e: any) => setError(e?.message ?? 'upload failed'),
  });
  const run = useMutation({
    mutationFn: () => importRun(preview!.importId, mapping, runTriage),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['meta'] });
    },
    onError: (e: any) => setError(e?.message ?? 'import failed'),
  });

  return (
    <div className="admin-card admin-card-wide">
      <h3>Import from ServiceNow</h3>
      <p className="admin-hint">
        Upload an incident-list CSV export. Columns are auto-detected and
        adjustable below; original numbers land in the ticket as a crosswalk
        (searchable), unknown callers become requester accounts, and
        re-importing the same file skips rows already imported.
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = '';
        }}
      />
      {error && <p className="admin-error">{error}</p>}
      {upload.isPending && <p className="admin-hint">Parsing…</p>}

      {preview && (
        <div className="import-preview">
          <p className="admin-hint">
            <strong>{preview.rowCount} rows</strong> detected.
            {preview.warnings.map((w) => <span key={w} className="import-warning"> ⚠ {w}</span>)}
          </p>
          <div className="import-mapping">
            {IMPORT_FIELD_LABELS.map(([field, label]) => (
              <label key={field} className="import-map-row">
                <span>{label}</span>
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((m) => {
                    const next = { ...m };
                    if (e.target.value) next[field] = e.target.value;
                    else delete next[field];
                    return next;
                  })}
                >
                  <option value="">— not imported —</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <table className="import-sample">
            <thead>
              <tr><th>Number</th><th>Subject</th><th>Caller</th><th>State</th><th>Pri</th><th>Opened</th></tr>
            </thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i}>
                  <td>{r.legacyNumber}</td>
                  <td>{(r.subject ?? '').slice(0, 48)}</td>
                  <td>{r.requester}</td>
                  <td>{r.state}</td>
                  <td>{r.priority?.slice(0, 10)}</td>
                  <td>{r.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="toolbar-check import-triage">
            <input type="checkbox" checked={runTriage} onChange={(e) => setRunTriage(e.target.checked)} />
            Run AI triage on imported open tickets (first 15 now, rest via the AI Triage tab)
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
            <button className="btn primary" disabled={run.isPending || !mapping.subject} onClick={() => run.mutate()}>
              {run.isPending ? 'Importing…' : `Import ${preview.rowCount} tickets`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="import-result">
          <p>
            ✅ <strong>{result.created} imported</strong>
            {result.skippedDupes > 0 && <> · {result.skippedDupes} already imported (skipped)</>}
            {result.requestersProvisioned > 0 && <> · {result.requestersProvisioned} requester account{result.requestersProvisioned === 1 ? '' : 's'} created</>}
            {result.openImported > 0 && <> · {result.openImported} still open</>}
            {result.triageQueued > 0 && <> · AI triage running on {result.triageQueued}</>}
          </p>
          {result.errors.length > 0 && (
            <p className="import-warning">
              ⚠ {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped:{' '}
              {result.errors.slice(0, 3).map((e) => `row ${e.row} (${e.reason})`).join(', ')}
              {result.errors.length > 3 ? '…' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const ADMIN_SECTIONS = [
  {
    key: 'scoring', label: 'Scoring', icon: '📈',
    hint: 'What rises to the top of the queue',
    cards: [ScoreWeightsCard, KeywordsCard],
  },
  {
    key: 'sla', label: 'SLA & Statuses', icon: '⏱',
    hint: 'Clocks, targets, and the status vocabulary',
    cards: [SlaCard, StatusesCard],
  },
  {
    key: 'routing', label: 'Routing & Approvals', icon: '🧭',
    hint: 'Where tickets go and who signs off',
    cards: [RulesCard, ApprovalGatesCard, EscalationCard, QueueNotifyCard],
  },
  {
    key: 'automation', label: 'AI & Automation', icon: '✨',
    hint: 'Confidence gates, auto-responses, schedules',
    cards: [AiCard, TemplatesCard, RecurringCard],
  },
  {
    key: 'agents', label: 'Agents', icon: '🎓',
    hint: 'Expertise that drives assignment',
    cards: [ExpertiseCard],
  },
  {
    key: 'users', label: 'Users & Queues', icon: '👥',
    hint: 'Queue membership and visibility',
    cards: [UserQueuesCard],
  },
  {
    key: 'import', label: 'Import', icon: '📦',
    hint: 'Bring your history over from ServiceNow',
    cards: [ImportCard],
  },
] as const;

export function Admin() {
  const { data: config, error } = useQuery({ queryKey: ['admin'], queryFn: fetchAdminConfig, retry: false });
  const [section, setSection] = useState<string>(ADMIN_SECTIONS[0].key);
  if (error) {
    return <div className="admin"><div className="empty">Admin requires the admin role — switch to Justin Rhoda in the user picker.</div></div>;
  }
  if (!config) return <div className="admin"><div className="empty">Loading…</div></div>;

  const active = ADMIN_SECTIONS.find((s) => s.key === section) ?? ADMIN_SECTIONS[0];
  return (
    <div className="admin admin-tabbed">
      <nav className="admin-tabs">
        {ADMIN_SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`admin-tab ${s.key === section ? 'active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            <span className="admin-tab-icon">{s.icon}</span>
            <span className="admin-tab-text">
              <span className="admin-tab-label">{s.label}</span>
              <span className="admin-tab-hint">{s.hint}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="admin-grid">
        {active.cards.map((Card, i) => <Card key={`${active.key}-${i}`} config={config} />)}
      </div>
    </div>
  );
}
