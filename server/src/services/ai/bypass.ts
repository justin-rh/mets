// AI triage bypass: tickets that route the same way every time skip the LLM
// entirely. Admin-defined rules match a case-insensitive substring against
// the subject and/or attachment filenames and pin the queue (plus optional
// category and priority). First matching rule wins; the routing is applied
// as actor 'rule' so the activity trail shows exactly what happened — and
// zero AI spend is recorded because no model was called.
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { applyTicketChanges, type TicketChanges } from '../ticketService.js';

const { tickets, attachments, teams, categories, ticketEvents, appConfig } = schema;

export type BypassRule = {
  term: string;
  where: 'subject' | 'attachment' | 'either';
  queueSlug: string;
  categoryName?: string | null;
  priority?: number | null;
};

export async function getBypassRules(): Promise<BypassRule[]> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'ai_bypass_rules'));
  return (row?.value as BypassRule[] | undefined) ?? [];
}

/**
 * Check a ticket against the bypass rules and, on the first match, route it
 * deterministically — the caller then skips AI triage. Returns the matched
 * rule, or null when the ticket should go through normal AI triage.
 */
export async function applyAiBypass(ticketId: number): Promise<BypassRule | null> {
  const rules = await getBypassRules();
  if (rules.length === 0) return null;

  const [t] = await db.select({ subject: tickets.subject })
    .from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return null;

  const needAttachments = rules.some((r) => r.where !== 'subject');
  const names = needAttachments
    ? (await db.select({ filename: attachments.filename }).from(attachments)
        .where(eq(attachments.ticketId, ticketId))).map((a) => a.filename.toLowerCase())
    : [];
  const subject = t.subject.toLowerCase();

  const rule = rules.find((r) => {
    const term = r.term.toLowerCase();
    const inSubject = subject.includes(term);
    const inAttachment = names.some((n) => n.includes(term));
    return r.where === 'subject' ? inSubject
      : r.where === 'attachment' ? inAttachment
      : inSubject || inAttachment;
  });
  if (!rule) return null;

  // Stale rule (queue renamed/removed) — fall through to AI rather than
  // strand the ticket.
  const [queue] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, rule.queueSlug));
  if (!queue) return null;

  const changes: TicketChanges = { queueId: queue.id };
  if (rule.categoryName) {
    const [cat] = await db.select({ id: categories.id }).from(categories)
      .where(eq(categories.name, rule.categoryName));
    if (cat) changes.categoryId = cat.id;
  }
  if (rule.priority) changes.priority = rule.priority;

  await applyTicketChanges(ticketId, { id: null, type: 'rule' }, changes);

  // Marker: renders in the UI ("rule-routed, AI skipped") and excludes the
  // ticket from batch-triage backlog sweeps.
  await db.execute(sql`
    update tickets
    set custom_fields = custom_fields || ${JSON.stringify({ aiBypassRule: rule.term })}::jsonb
    where id = ${ticketId}
  `);
  await db.insert(ticketEvents).values({
    ticketId, actorId: null, actorType: 'rule', eventType: 'ai_bypassed',
    field: 'triage', newValue: `matched "${rule.term}" — routed without AI`,
  });
  return rule;
}

// ---------------------------------------------------------------------------
// Bypass suggestions: SOTO notices what it keeps routing the same way and
// proposes a rule so those tickets stop paying for AI. Fully deterministic
// (SQL + code, no model call); refreshed alongside the weekly briefing and
// on demand from the admin card.
// ---------------------------------------------------------------------------

const SUGGESTIONS_KEY = 'ai_bypass_suggestions';
const MIN_REPEATS = 3;
const MIN_TERM_LENGTH = 10;

export type BypassSuggestion = {
  term: string;
  where: 'subject';
  queueSlug: string;
  queueName: string;
  categoryName: string | null;
  count: number;
  sampleSubjects: string[];
};

type SuggestionState = {
  suggestions: BypassSuggestion[];
  dismissed: string[];
  computedAt: string | null;
};

export async function getBypassSuggestionState(): Promise<SuggestionState> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, SUGGESTIONS_KEY));
  const v = row?.value as Partial<SuggestionState> | undefined;
  return { suggestions: v?.suggestions ?? [], dismissed: v?.dismissed ?? [], computedAt: v?.computedAt ?? null };
}

async function saveSuggestionState(state: SuggestionState) {
  await db.insert(appConfig)
    .values({ key: SUGGESTIONS_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: state, updatedAt: new Date() } });
}

/** Dismissed terms stop being re-suggested by future scans. */
export async function dismissBypassSuggestion(term: string) {
  const state = await getBypassSuggestionState();
  return saveSuggestionState({
    ...state,
    suggestions: state.suggestions.filter((s) => s.term !== term),
    dismissed: [...new Set([...state.dismissed, term])],
  });
}

/** Drop suggestions already covered by a saved rule (called when rules change). */
export async function pruneCoveredSuggestions(rules: BypassRule[]) {
  const state = await getBypassSuggestionState();
  const covered = (term: string) =>
    rules.some((r) => term.toLowerCase().includes(r.term.toLowerCase()));
  const kept = state.suggestions.filter((s) => !covered(s.term));
  if (kept.length !== state.suggestions.length) {
    await saveSuggestionState({ ...state, suggestions: kept });
  }
}

/** Longest common prefix of the group's subjects, trimmed to a clean term. */
function commonPrefix(subjects: string[]): string {
  let prefix = subjects[0] ?? '';
  for (const s of subjects.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i]!.toLowerCase() === s[i]!.toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  // Trim dangling separators/digits so the term reads like a phrase.
  return prefix.replace(/[\s\-–—#:·.,/\d]+$/u, '');
}

/**
 * Scan the last 30 days of AI-triaged tickets for repeated subject patterns
 * that always landed in the same place with no agent corrections — the
 * tickets that don't need a model to route them.
 */
export async function computeBypassSuggestions(): Promise<BypassSuggestion[]> {
  const rows = (await db.execute(sql`
    select t.subject, tm.slug as queue_slug, tm.name as queue_name, c.name as category_name,
      exists (
        select 1 from ai_enrichments e
        where e.ticket_id = t.id and e.feature = 'triage' and e.status = 'corrected'
      ) as corrected
    from tickets t
    join teams tm on tm.id = t.queue_id
    left join categories c on c.id = t.category_id
    where t.created_at > now() - interval '30 days'
      and t.subject not ilike 'suspected incident:%'
      and not (t.custom_fields ? 'aiBypassRule')
      and exists (
        select 1 from ai_enrichments e
        where e.ticket_id = t.id and e.feature = 'triage'
      )
  `)).rows as { subject: string; queue_slug: string; queue_name: string; category_name: string | null; corrected: boolean }[];

  // Automated/recurring tickets share a subject skeleton with variable
  // numbers (dates, batch ids, sites) — normalize digits away to group them.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.subject.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    if (key.length < MIN_TERM_LENGTH) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const [rules, state] = [await getBypassRules(), await getBypassSuggestionState()];
  const alreadyHandled = (term: string) => {
    const lower = term.toLowerCase();
    return rules.some((r) => lower.includes(r.term.toLowerCase()))
      || state.dismissed.some((d) => d.toLowerCase() === lower);
  };

  const suggestions: BypassSuggestion[] = [];
  for (const members of groups.values()) {
    if (members.length < MIN_REPEATS) continue;
    // Deterministic candidates only: one destination, zero corrections.
    const queues = new Set(members.map((m) => m.queue_slug));
    if (queues.size !== 1 || members.some((m) => m.corrected)) continue;
    const term = commonPrefix(members.map((m) => m.subject));
    if (term.length < MIN_TERM_LENGTH || alreadyHandled(term)) continue;
    const categories = new Set(members.map((m) => m.category_name));
    suggestions.push({
      term,
      where: 'subject',
      queueSlug: members[0]!.queue_slug,
      queueName: members[0]!.queue_name,
      categoryName: categories.size === 1 ? members[0]!.category_name : null,
      count: members.length,
      sampleSubjects: [...new Set(members.map((m) => m.subject))].slice(0, 2),
    });
  }
  suggestions.sort((a, b) => b.count - a.count);
  const top = suggestions.slice(0, 10);

  await saveSuggestionState({
    suggestions: top,
    dismissed: state.dismissed,
    computedAt: new Date().toISOString(),
  });
  return top;
}
