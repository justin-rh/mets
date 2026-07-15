import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getBotUser } from './templates.js';

const { tickets, ticketEvents, ticketComments, statuses, teams, users } = schema;

/**
 * ServiceNow (and friends) migration: parse an incident-list CSV export,
 * auto-map its columns, and file the history into METS — original numbers
 * preserved in tickets.legacy_number, unknown callers auto-provisioned as
 * requesters. Re-running the same file is safe: rows whose legacy number
 * already exists are skipped.
 */

// ---------------------------------------------------------------------------
// RFC 4180 CSV — quoted fields, embedded commas/newlines/quotes.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // BOM from Excel exports
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Field mapping. Keys are METS fields; values are source column names.

export const IMPORT_FIELDS = [
  'legacyNumber', 'subject', 'description', 'requester', 'state',
  'priority', 'createdAt', 'resolvedAt', 'closedAt', 'queue', 'notes',
] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export type ImportMapping = Partial<Record<ImportField, string>>;

/** Header-name heuristics for the usual ServiceNow export columns. */
export function autoMap(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const grab = (field: ImportField, ...patterns: RegExp[]) => {
    if (mapping[field]) return;
    for (const p of patterns) {
      const hit = headers.find((h) => p.test(h.trim().toLowerCase()));
      if (hit) { mapping[field] = hit; return; }
    }
  };
  grab('legacyNumber', /^(number|task number|incident number|id)$/);
  grab('subject', /^short[ _]description$/, /^(subject|title|summary)$/);
  grab('description', /^description$/, /^(details|long description)$/);
  grab('requester', /^caller([ _]id)?$/, /^(opened[ _]by|requester|requested[ _]for|customer|contact)$/);
  grab('state', /^(incident[ _])?state$/, /^status$/);
  grab('priority', /^priority$/, /^urgency$/);
  grab('createdAt', /^(opened([ _]at)?|sys[ _]created[ _]on|created([ _]at|[ _]on)?)$/);
  grab('resolvedAt', /^resolved([ _]at)?$/);
  grab('closedAt', /^closed([ _]at)?$/);
  grab('queue', /^assignment[ _]group$/, /^(group|team|queue)$/);
  grab('notes', /^comments[ _]and[ _]work[ _]notes$/, /^(work[ _]notes|comments|activity)$/);
  return mapping;
}

// ---------------------------------------------------------------------------
// Preview stash: parsed files wait server-side for the run call (15 min).

const stash = new Map<string, { headers: string[]; rows: string[][]; at: number }>();
const STASH_TTL = 15 * 60_000;

export function previewImport(csvText: string) {
  for (const [k, v] of stash) if (Date.now() - v.at > STASH_TTL) stash.delete(k);

  const parsed = parseCsv(csvText);
  if (parsed.length < 2) {
    throw Object.assign(new Error('need a header row and at least one data row'), { statusCode: 400 });
  }
  const headers = parsed[0]!.map((h) => h.trim());
  const rows = parsed.slice(1);
  const importId = `imp_${Math.random().toString(36).slice(2, 10)}`;
  stash.set(importId, { headers, rows, at: Date.now() });

  const mapping = autoMap(headers);
  const warnings: string[] = [];
  if (!mapping.subject) warnings.push('No subject column detected — map one before importing.');
  if (!mapping.requester) warnings.push('No caller/requester column detected — tickets would import under the importing admin.');
  if (!mapping.legacyNumber) warnings.push('No ticket-number column detected — re-import dedupe needs one.');

  const idx = (col?: string) => (col ? headers.indexOf(col) : -1);
  const sample = rows.slice(0, 5).map((r) => Object.fromEntries(
    IMPORT_FIELDS.map((f) => [f, idx(mapping[f]) >= 0 ? r[idx(mapping[f])] ?? '' : '']),
  ));

  return { importId, headers, mapping, rowCount: rows.length, sample, warnings };
}

// ---------------------------------------------------------------------------

const STATE_CATEGORY: [RegExp, 'new' | 'open' | 'pending' | 'resolved' | 'closed'][] = [
  [/^new$/i, 'new'],
  [/in.?progress|active|open|assigned|work/i, 'open'],
  [/hold|pending|await/i, 'pending'],
  [/resolved/i, 'resolved'],
  [/closed|cancell?ed|complete/i, 'closed'],
];

function parsePriority(raw: string): number {
  const n = parseInt(raw, 10); // "1 - Critical" and plain "1" both parse
  if (Number.isNaN(n)) return 3;
  return Math.min(Math.max(n, 1), 4); // SNOW P5 (planning) folds into P4
}

function parseWhen(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolveRequester(raw: string, provisioned: Map<string, number>): Promise<{ id: number; provisioned: boolean }> {
  const value = raw.trim();
  const cached = provisioned.get(value.toLowerCase());
  if (cached) return { id: cached, provisioned: false };

  const isEmail = /@/.test(value);
  const [existing] = isEmail
    ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${value.toLowerCase()}`)
    : await db.select({ id: users.id }).from(users).where(sql`lower(${users.name}) = ${value.toLowerCase()}`);
  if (existing) {
    provisioned.set(value.toLowerCase(), existing.id);
    return { id: existing.id, provisioned: false };
  }

  const name = isEmail
    ? value.split('@')[0]!.split(/[._]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ')
    : value;
  const email = isEmail
    ? value.toLowerCase()
    : `${value.toLowerCase().replace(/[^a-z]+/g, '.')}@masterelectronics.com`;
  const [created] = await db.insert(users)
    .values({ name, email, role: 'requester', location: 'Remote' })
    .onConflictDoNothing()
    .returning({ id: users.id });
  const id = created?.id
    ?? (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;
  provisioned.set(value.toLowerCase(), id);
  return { id, provisioned: !!created };
}

export async function runImport(importId: string, mapping: ImportMapping, opts: { runTriage?: boolean }) {
  const stashed = stash.get(importId);
  if (!stashed || Date.now() - stashed.at > STASH_TTL) {
    throw Object.assign(new Error('import expired — upload the file again'), { statusCode: 400 });
  }
  if (!mapping.subject) {
    throw Object.assign(new Error('a subject column mapping is required'), { statusCode: 400 });
  }
  const { headers, rows } = stashed;
  const idx = (col?: string) => (col ? headers.indexOf(col) : -1);
  const cell = (row: string[], field: ImportField) => {
    const i = idx(mapping[field]);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };

  const statusRows = await db.select().from(statuses).orderBy(statuses.position);
  const statusFor = (cat: string) => statusRows.find((s) => s.category === cat) ?? statusRows[0]!;
  const teamRows = await db.select({ id: teams.id, name: teams.name, slug: teams.slug }).from(teams);
  const catchAll = teamRows.find((t) => t.slug === 'it-support') ?? teamRows[0]!;
  const bot = await getBotUser();
  const provisioned = new Map<string, number>();

  let created = 0, skippedDupes = 0, requestersProvisioned = 0;
  const errors: { row: number; reason: string }[] = [];
  const openImported: number[] = [];

  for (let n = 0; n < rows.length; n++) {
    const row = rows[n]!;
    try {
      const subject = cell(row, 'subject');
      if (!subject) { errors.push({ row: n + 2, reason: 'empty subject' }); continue; }

      const legacy = cell(row, 'legacyNumber') || null;
      if (legacy) {
        const [dupe] = await db.select({ id: tickets.id }).from(tickets)
          .where(eq(tickets.legacyNumber, legacy));
        if (dupe) { skippedDupes++; continue; }
      }

      const requesterRaw = cell(row, 'requester');
      let requesterId = 1;
      if (requesterRaw) {
        const r = await resolveRequester(requesterRaw, provisioned);
        requesterId = r.id;
        if (r.provisioned) requestersProvisioned++;
      }

      const category = STATE_CATEGORY.find(([re]) => re.test(cell(row, 'state')))?.[1] ?? 'open';
      const status = statusFor(category);
      const queueRaw = cell(row, 'queue').toLowerCase();
      const queue = queueRaw
        ? teamRows.find((t) => t.name.toLowerCase() === queueRaw
            || t.name.toLowerCase().includes(queueRaw) || queueRaw.includes(t.name.toLowerCase())) ?? catchAll
        : catchAll;

      const createdAt = parseWhen(cell(row, 'createdAt')) ?? new Date();
      const resolvedAt = category === 'resolved' || category === 'closed'
        ? parseWhen(cell(row, 'resolvedAt')) ?? parseWhen(cell(row, 'closedAt')) ?? createdAt
        : null;
      const closedAt = category === 'closed' ? parseWhen(cell(row, 'closedAt')) ?? resolvedAt : null;

      const [t] = await db.insert(tickets).values({
        subject: subject.slice(0, 300),
        description: cell(row, 'description').slice(0, 20_000) || subject,
        type: 'incident',
        priority: parsePriority(cell(row, 'priority')),
        statusId: status.id,
        queueId: queue.id,
        requesterId,
        source: 'api',
        legacyNumber: legacy,
        createdAt,
        updatedAt: resolvedAt ?? createdAt,
        resolvedAt,
        closedAt,
      }).returning({ id: tickets.id });

      await db.insert(ticketEvents).values({
        ticketId: t!.id, actorId: null, actorType: 'system', eventType: 'imported',
        field: 'source', oldValue: 'servicenow', newValue: legacy ?? '(no number)', createdAt,
      });
      const notes = cell(row, 'notes');
      if (notes) {
        await db.insert(ticketComments).values({
          ticketId: t!.id, authorId: bot.id, visibility: 'internal', source: 'api',
          bodyText: `Imported work notes:\n\n${notes.slice(0, 9_500)}`, createdAt,
        });
      }
      if (category !== 'resolved' && category !== 'closed') {
        const { attachSlas } = await import('./sla/slaService.js');
        await attachSlas(db, t!.id, parsePriority(cell(row, 'priority'))).catch(() => {});
        const { recomputeScore } = await import('./scoring.js');
        await recomputeScore(db, t!.id).catch(() => {});
        openImported.push(t!.id);
      }
      created++;
    } catch (e: any) {
      errors.push({ row: n + 2, reason: String(e?.message ?? e).slice(0, 120) });
    }
  }
  stash.delete(importId);

  // Optional: AI triage over imported OPEN tickets, capped to protect the
  // token budget — the rest are one "Run AI Triage" click away.
  const TRIAGE_CAP = 15;
  let triageQueued = 0;
  if (opts.runTriage && openImported.length) {
    const ids = openImported.slice(0, TRIAGE_CAP);
    triageQueued = ids.length;
    void (async () => {
      const { enrichTicket } = await import('./ai/enrichment.js');
      for (const id of ids) {
        await enrichTicket(id, 'auto').catch((e) =>
          console.error(`[import] triage failed for ticket ${id}:`, e));
      }
    })();
  }

  return {
    created, skippedDupes, requestersProvisioned, errors,
    openImported: openImported.length, triageQueued,
    triageRemaining: opts.runTriage ? Math.max(0, openImported.length - triageQueued) : openImported.length,
  };
}
