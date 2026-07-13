// Seed generator — deterministic (seeded PRNG), so every reseed produces the
// same demo data. Run: npm run db:seed
//
// SLA target times here are wall-clock approximations; the real business-hours
// math arrives with the SLA engine and recomputes on live tickets.
import { sql } from 'drizzle-orm';
import { db, pool } from './index.js';
import {
  agentSkills, aiUsage, appConfig, approvals, attachments, categories,
  kbArticles, kbChunks, routingRules, skills, slaInstances, slaPolicies,
  statuses, tags, teamMemberships, teams, ticketComments, ticketEvents,
  ticketLinks, ticketStatusDurations, ticketTags, tickets, users,
  aiEnrichments,
} from './schema.js';
import {
  AGENT_COMMENTS, APPS, CATEGORIES, CATEGORY_TAGS, DEPARTMENTS, DEVICES,
  FIRST_NAMES, INTERNAL_NOTES, KB_ARTICLES, LAST_NAMES, LOCATIONS, PRINTERS,
  QUEUES, REPORTS, REQUESTER_REPLIES, SKILLS, TAGS, TEMPLATES, VENDORS,
} from './seed-data.js';

const TICKET_COUNT = 800;
const AGENT_COUNT = 24;
const REQUESTER_COUNT = 45;

// --- deterministic PRNG -----------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
function weighted(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// --- time helpers ------------------------------------------------------------

const NOW = new Date();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function randomCreatedAt(): Date {
  // Skew toward recent days; land on a weekday during working hours.
  const daysAgo = Math.floor(120 * Math.pow(rand(), 1.4));
  const d = new Date(NOW.getTime() - daysAgo * DAY);
  if (d.getDay() === 0) d.setTime(d.getTime() - 2 * DAY);
  if (d.getDay() === 6) d.setTime(d.getTime() - DAY);
  d.setHours(int(7, 17), int(0, 59), int(0, 59), 0);
  return d;
}

function businessDaysBetween(a: Date, b: Date): number {
  let days = 0;
  const cur = new Date(a);
  while (cur < b) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setTime(cur.getTime() + DAY);
  }
  return days;
}

// --- scoring (mirrors app_config.score_weights) ------------------------------

const PRIORITY_WEIGHT: Record<number, number> = { 1: 40, 2: 25, 3: 12, 4: 5 };

function computeScore(opts: {
  priority: number; ageBusinessDays: number; vip: boolean;
  slaState: 'ok' | 'warning' | 'breached'; manualBoost: number;
}): number {
  return (
    PRIORITY_WEIGHT[opts.priority]! +
    Math.min(2 * opts.ageBusinessDays, 20) +
    (opts.vip ? 15 : 0) +
    (opts.slaState === 'warning' ? 10 : opts.slaState === 'breached' ? 25 : 0) +
    opts.manualBoost
  );
}

// --- template filling ---------------------------------------------------------

function fill(template: string, dept: string): string {
  return template
    .replaceAll('{app}', pick(APPS))
    .replaceAll('{loc}', pick(LOCATIONS))
    .replaceAll('{vendor}', pick(VENDORS))
    .replaceAll('{device}', pick(DEVICES))
    .replaceAll('{printer}', pick(PRINTERS))
    .replaceAll('{report}', pick(REPORTS))
    .replaceAll('{dept}', dept);
}

async function insertChunked<T extends { values: (rows: any[]) => any }>(
  table: any, rows: any[], chunk = 400,
) {
  for (let i = 0; i < rows.length; i += chunk) {
    await db.insert(table).values(rows.slice(i, i + chunk));
  }
}

// ==============================================================================

async function main() {
  console.log('Truncating…');
  await db.execute(sql`
    TRUNCATE ai_usage, ai_enrichments, kb_chunks, kb_articles, sla_instances,
      sla_policies, routing_rules, approvals, attachments,
      ticket_status_durations, ticket_events, ticket_comments, ticket_links,
      ticket_tags, tickets, agent_skills, skills, custom_field_definitions,
      tags, categories, statuses, team_memberships, teams, users, app_config
    RESTART IDENTITY CASCADE
  `);
  await db.execute(sql`ALTER SEQUENCE ticket_number_seq RESTART WITH 1000000`);

  // --- reference data ---------------------------------------------------------

  const statusRows = await db.insert(statuses).values([
    { name: 'New', category: 'new', position: 1, isDefault: true },
    { name: 'Open', category: 'open', position: 2 },
    { name: 'In Progress', category: 'open', position: 3 },
    { name: 'Waiting on Requester', category: 'pending', position: 4 },
    { name: 'Waiting on Vendor', category: 'pending', position: 5 },
    { name: 'Resolved', category: 'resolved', position: 6 },
    { name: 'Closed', category: 'closed', position: 7 },
  ]).returning();
  const statusByName = Object.fromEntries(statusRows.map((s) => [s.name, s]));

  const teamRows = await db.insert(teams).values(
    QUEUES.map((q) => ({ name: q.name, slug: q.slug, description: q.description, assignmentPolicy: q.policy as any })),
  ).returning();
  const teamBySlug = Object.fromEntries(teamRows.map((t) => [t.slug, t]));

  const categoryRows = await db.insert(categories).values(
    CATEGORIES.map((c) => ({ name: c.name, description: c.description })),
  ).returning();
  const categoryByName = Object.fromEntries(categoryRows.map((c) => [c.name, c]));

  const tagRows = await db.insert(tags).values(TAGS.map((name) => ({ name }))).returning();
  const skillRows = await db.insert(skills).values(SKILLS.map((name) => ({ name }))).returning();

  await db.insert(slaPolicies).values([
    { name: 'P1 — Critical', conditions: { priority: 1 }, firstResponseMinutes: 30, resolutionMinutes: 240 },
    { name: 'P2 — High', conditions: { priority: 2 }, firstResponseMinutes: 60, resolutionMinutes: 480 },
    { name: 'P3 — Normal', conditions: { priority: 3 }, firstResponseMinutes: 240, resolutionMinutes: 1440 },
    { name: 'P4 — Low', conditions: { priority: 4 }, firstResponseMinutes: 480, resolutionMinutes: 4320 },
  ]);
  const policyByPriority: Record<number, { id: number; fr: number; res: number }> = {
    1: { id: 1, fr: 30, res: 240 }, 2: { id: 2, fr: 60, res: 480 },
    3: { id: 3, fr: 240, res: 1440 }, 4: { id: 4, fr: 480, res: 4320 },
  };

  await db.insert(appConfig).values([
    {
      key: 'score_weights',
      value: {
        priority: { '1': 40, '2': 25, '3': 12, '4': 5 },
        agePerBusinessDay: 2, ageCap: 20, vip: 15,
        slaWarning: 10, slaBreached: 25, manualBoostRange: 10,
      },
    },
    {
      key: 'business_hours',
      value: { timezone: 'America/Phoenix', days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
    },
  ]);

  await db.insert(routingRules).values([
    {
      name: 'VPN issues → Infrastructure', position: 1, trigger: 'ticket_created',
      conditions: { any: [{ field: 'subject', op: 'contains', value: 'vpn' }, { field: 'description', op: 'contains', value: 'vpn' }] },
      actions: { setQueue: 'infra-network', addTags: ['vpn'] },
    },
    {
      name: 'Phishing → Security, min P2', position: 2, trigger: 'ticket_created',
      conditions: { any: [{ field: 'subject', op: 'contains', value: 'phishing' }, { field: 'description', op: 'contains', value: 'suspicious' }] },
      actions: { setQueue: 'security-access', minPriority: 2, addTags: ['phishing'] },
    },
    {
      name: 'EDI failures → MERP', position: 3, trigger: 'ticket_created',
      conditions: { any: [{ field: 'subject', op: 'contains', value: 'edi' }] },
      actions: { setQueue: 'merp', addTags: ['edi'] },
    },
    {
      name: 'VIP requesters flagged', position: 4, trigger: 'ticket_created',
      conditions: { all: [{ field: 'requester.isVip', op: 'eq', value: true }] },
      actions: { minPriority: 2, addTags: ['exec-visibility'] },
    },
  ]);

  // --- users -------------------------------------------------------------------

  const usedNames = new Set<string>();
  function person() {
    let first: string, last: string, key: string;
    do {
      first = pick(FIRST_NAMES); last = pick(LAST_NAMES);
      key = `${first}.${last}`;
    } while (usedNames.has(key));
    usedNames.add(key);
    return { name: `${first} ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@masterelectronics.com` };
  }

  const userRows: (typeof users.$inferInsert)[] = [
    { name: 'Justin Rhoda', email: 'justin.rhoda@masterelectronics.com', department: 'IT', role: 'admin' },
  ];
  for (let i = 0; i < AGENT_COUNT; i++) {
    userRows.push({ ...person(), department: 'IT', role: 'agent' });
  }
  const execTitles = ['Sales', 'Operations', 'Finance', 'Product Management'];
  for (const dept of execTitles) {
    userRows.push({ ...person(), department: dept, role: 'requester', isVip: true });
  }
  for (let i = 0; i < REQUESTER_COUNT; i++) {
    userRows.push({ ...person(), department: pick(DEPARTMENTS), role: 'requester' });
  }
  const allUsers = await db.insert(users).values(userRows).returning();
  const agents = allUsers.filter((u) => u.role === 'agent');
  const requesters = allUsers.filter((u) => u.role === 'requester');
  const vips = requesters.filter((u) => u.isVip);

  // Rotate agents across queues so everyone is on at least one team; the
  // wrap-around gives a couple of agents dual membership. One lead per queue.
  const membershipRows: (typeof teamMemberships.$inferInsert)[] = [];
  const agentsByTeam = new Map<number, typeof agents>();
  let agentPtr = 0;
  teamRows.forEach((team, ti) => {
    const size = ti === 0 ? 4 : 3; // IT Support is the biggest team
    const members: typeof agents = [];
    for (let i = 0; i < size; i++) {
      const agent = agents[agentPtr++ % agents.length]!;
      if (members.includes(agent)) continue;
      members.push(agent);
      membershipRows.push({ userId: agent.id, teamId: team.id, role: i === 0 ? 'lead' : 'member' });
    }
    agentsByTeam.set(team.id, members);
  });
  // The admin works tickets too — give him team homes so My Categories
  // and skills-based views have content for the default demo user.
  const admin = allUsers.find((u) => u.role === 'admin')!;
  membershipRows.push(
    { userId: admin.id, teamId: teamBySlug['it-support']!.id, role: 'member' },
    { userId: admin.id, teamId: teamBySlug['merp']!.id, role: 'member' },
  );
  await db.insert(teamMemberships).values(membershipRows);

  const skillLinks: (typeof agentSkills.$inferInsert)[] = [];
  const seenSkill = new Set<string>();
  for (const agent of agents) {
    for (let i = 0, n = int(2, 4); i < n; i++) {
      const skill = pick(skillRows);
      const key = `${agent.id}-${skill.id}`;
      if (seenSkill.has(key)) continue;
      seenSkill.add(key);
      skillLinks.push({ userId: agent.id, skillId: skill.id, level: int(1, 3) });
    }
  }
  await db.insert(agentSkills).values(skillLinks);

  // --- knowledge base -----------------------------------------------------------

  await db.insert(kbArticles).values(
    KB_ARTICLES.map((a) => ({
      title: a.title, bodyText: a.body, status: 'published' as const,
      authorId: pick(agents).id,
    })),
  );

  // --- tickets -------------------------------------------------------------------

  type Pending = {
    row: typeof tickets.$inferInsert;
    isOpen: boolean;
    statusName: string;
    slaFlag: 'ok' | 'warning' | 'breached';
    comments: { authorId: number; visibility: 'public' | 'internal'; bodyText: string; offsetMs: number; source: 'agent' | 'portal' }[];
    events: { actorId: number | null; actorType: 'user' | 'system' | 'rule' | 'ai'; eventType: string; field?: string; oldValue?: string; newValue?: string; offsetMs: number }[];
    tagIds: number[];
    sla: (typeof slaInstances.$inferInsert & { ticketId?: never })[];
  };

  const categoryNames = Object.keys(TEMPLATES);
  const pendingTickets: Pending[] = [];
  // Reserve slots among recent open tickets for the SLA demo.
  let warningQuota = 6;
  let breachQuota = 3;

  for (let i = 0; i < TICKET_COUNT; i++) {
    const catName = pick(categoryNames);
    const template = pick(TEMPLATES[catName]!);
    const catDef = CATEGORIES.find((c) => c.name === catName)!;
    const queue = teamBySlug[catDef.queue]!;
    const teamAgents = agentsByTeam.get(queue.id)!;

    const requester = chance(0.06) && vips.length ? pick(vips) : pick(requesters);
    const dept = requester.department ?? 'Sales';
    const priority = weighted(template.pri ?? [5, 20, 55, 20]) + 1;
    const createdAt = randomCreatedAt();
    const ageDays = (NOW.getTime() - createdAt.getTime()) / DAY;

    // Older tickets are overwhelmingly closed.
    const pClosed = ageDays > 30 ? 0.97 : ageDays > 14 ? 0.85 : ageDays > 7 ? 0.6 : ageDays > 3 ? 0.4 : 0.15;
    const resHoursMax = priority === 1 ? 12 : priority === 2 ? 36 : priority === 3 ? 96 : 200;
    const resHours = 0.5 + (resHoursMax - 0.5) * rand() * rand(); // skew fast
    const resolvedAt = new Date(createdAt.getTime() + resHours * HOUR);
    const isOpen = !(chance(pClosed) && resolvedAt < NOW);

    const assignee = isOpen && chance(0.72) ? pick(teamAgents) : !isOpen ? pick(teamAgents) : null;
    let statusName: string;
    if (!isOpen) {
      statusName = NOW.getTime() - resolvedAt.getTime() > 7 * DAY ? 'Closed' : 'Resolved';
    } else if (!assignee) {
      statusName = 'New';
    } else {
      statusName = pick(['In Progress', 'In Progress', 'In Progress', 'Open', 'Open', 'Waiting on Requester', 'Waiting on Vendor']);
    }
    const isPending = statusName.startsWith('Waiting');

    // SLA state feeds the score. Old open backlog is naturally past target;
    // demo flags force a few *recent* tickets into warning/just-breached so
    // judges can watch one cross the line live.
    const naturalTarget = createdAt.getTime() + policyByPriority[priority]!.res * 60_000;
    let slaFlag: Pending['slaFlag'] = 'ok'; // feeds the score
    let demoFlag: 'none' | 'warning' | 'breached' = 'none'; // forces target near NOW
    if (isOpen && !isPending && naturalTarget < NOW.getTime()) {
      slaFlag = 'breached';
    } else if (isOpen && !isPending && ageDays < 3) {
      if (breachQuota > 0 && chance(0.25)) { slaFlag = 'breached'; demoFlag = 'breached'; breachQuota--; }
      else if (warningQuota > 0 && chance(0.3)) { slaFlag = 'warning'; demoFlag = 'warning'; warningQuota--; }
    }

    const firstResponded = assignee && (!isOpen || statusName !== 'New')
      ? new Date(createdAt.getTime() + Math.min(resHours * 0.25, 4) * HOUR * (0.3 + rand()))
      : null;
    const manualBoost = chance(0.008) ? pick([-5, 5, 8, 10]) : 0;
    const ageEnd = isOpen ? NOW : resolvedAt;
    const score = computeScore({
      priority, vip: requester.isVip,
      ageBusinessDays: businessDaysBetween(createdAt, ageEnd),
      slaState: slaFlag, manualBoost,
    });
    const snoozed = isOpen && !isPending && statusName !== 'New' && chance(0.07);

    const p: Pending = {
      isOpen, statusName, slaFlag,
      row: {
        type: template.t,
        subject: fill(template.s, dept),
        description: fill(template.d, dept),
        statusId: statusByName[statusName]!.id,
        priority, score,
        requesterId: requester.id,
        assigneeId: assignee?.id ?? null,
        queueId: queue.id,
        categoryId: categoryByName[catName]!.id,
        source: pick(['portal', 'portal', 'email', 'email', 'agent'] as const),
        snoozedUntil: snoozed ? new Date(NOW.getTime() + int(1, 5) * DAY) : null,
        snoozeReason: snoozed ? pick(['Waiting for user back from PTO', 'Parts arriving next week', 'Revisit after month-end close']) : null,
        manualBoost,
        createdAt,
        updatedAt: isOpen ? new Date(Math.min(createdAt.getTime() + resHours * 0.5 * HOUR, NOW.getTime())) : resolvedAt,
        firstRespondedAt: firstResponded,
        resolvedAt: isOpen ? null : resolvedAt,
        closedAt: statusName === 'Closed' ? new Date(resolvedAt.getTime() + 3 * DAY) : null,
      },
      comments: [], events: [], tagIds: [], sla: [],
    };

    // Events: created → assigned → status changes.
    p.events.push({ actorId: requester.id, actorType: 'user', eventType: 'created', offsetMs: 0 });
    if (assignee) {
      p.events.push({
        actorId: null, actorType: 'system', eventType: 'assigned',
        field: 'assignee', newValue: assignee.name, offsetMs: int(5, 90) * 60_000,
      });
      p.events.push({
        actorId: assignee.id, actorType: 'user', eventType: 'status_changed',
        field: 'status', oldValue: 'New', newValue: isOpen ? statusName : 'In Progress',
        offsetMs: int(10, 120) * 60_000,
      });
    }
    if (!isOpen) {
      p.events.push({
        actorId: assignee!.id, actorType: 'user', eventType: 'status_changed',
        field: 'status', oldValue: 'In Progress', newValue: statusName,
        offsetMs: resolvedAt.getTime() - createdAt.getTime(),
      });
    }

    // Comments.
    if (assignee && firstResponded) {
      p.comments.push({
        authorId: assignee.id, visibility: 'public', source: 'agent',
        bodyText: pick(AGENT_COMMENTS), offsetMs: firstResponded.getTime() - createdAt.getTime(),
      });
      if (chance(0.45)) p.comments.push({
        authorId: assignee.id, visibility: 'internal', source: 'agent',
        bodyText: pick(INTERNAL_NOTES), offsetMs: firstResponded.getTime() - createdAt.getTime() + int(10, 200) * 60_000,
      });
      if (chance(0.5)) p.comments.push({
        authorId: requester.id, visibility: 'public', source: 'portal',
        bodyText: pick(REQUESTER_REPLIES), offsetMs: firstResponded.getTime() - createdAt.getTime() + int(30, 500) * 60_000,
      });
      if (!isOpen) p.comments.push({
        authorId: assignee.id, visibility: 'public', source: 'agent',
        bodyText: 'This should be resolved now. Closing the ticket — reply if it comes back.',
        offsetMs: resolvedAt.getTime() - createdAt.getTime(),
      });
    }

    const affinity = CATEGORY_TAGS[catName];
    if (affinity) {
      // Ops tickets always carry a site/function tag — that's the queue-
      // consolidation story (site filters instead of per-site queues).
      const byName = new Map(tagRows.map((t) => [t.name, t]));
      const t1 = byName.get(pick(affinity));
      if (t1) p.tagIds.push(t1.id);
      if (chance(0.4)) {
        const t2 = byName.get(pick(affinity));
        if (t2 && !p.tagIds.includes(t2.id)) p.tagIds.push(t2.id);
      }
    } else if (chance(0.25)) {
      const t1 = pick(tagRows);
      p.tagIds.push(t1.id);
      if (chance(0.2)) {
        const t2 = pick(tagRows);
        if (t2.id !== t1.id) p.tagIds.push(t2.id);
      }
    }

    // SLA instances.
    const pol = policyByPriority[priority]!;
    const mk = (metric: 'first_response' | 'resolution', minutes: number) => {
      const durMs = minutes * 60_000;
      let targetAt = new Date(createdAt.getTime() + durMs);
      let state: 'running' | 'paused' | 'completed' | 'breached' = 'running';
      let completedAt: Date | null = null;
      let breachedAt: Date | null = null;
      const doneAt = metric === 'first_response' ? firstResponded : (isOpen ? null : resolvedAt);

      if (doneAt) {
        state = 'completed'; completedAt = doneAt;
        if (doneAt > targetAt) breachedAt = targetAt;
      } else if (isOpen) {
        if (metric === 'resolution' && demoFlag === 'warning') {
          targetAt = new Date(NOW.getTime() + int(20, 90) * 60_000);
        } else if (metric === 'resolution' && demoFlag === 'breached') {
          targetAt = new Date(NOW.getTime() - int(60, 360) * 60_000);
          state = 'breached'; breachedAt = targetAt;
        } else if (targetAt < NOW) {
          state = 'breached'; breachedAt = targetAt; // naturally overdue backlog
        }
        if (state === 'running' && isPending) state = 'paused';
      }
      return {
        policyId: pol.id, metric, state,
        startedAt: createdAt, targetAt,
        warnAt: new Date(targetAt.getTime() - durMs * 0.25),
        pausedAt: state === 'paused' ? new Date(NOW.getTime() - int(2, 48) * HOUR) : null,
        warnedAt: state === 'breached' || slaFlag === 'warning' ? new Date(targetAt.getTime() - durMs * 0.25) : null,
        breachedAt, completedAt,
      };
    };
    p.sla.push(mk('first_response', pol.fr) as any);
    p.sla.push(mk('resolution', pol.res) as any);

    pendingTickets.push(p);
  }

  console.log(`Inserting ${pendingTickets.length} tickets…`);
  const insertedIds: number[] = [];
  for (let i = 0; i < pendingTickets.length; i += 200) {
    const chunk = pendingTickets.slice(i, i + 200);
    const rows = await db.insert(tickets).values(chunk.map((p) => p.row)).returning({ id: tickets.id });
    insertedIds.push(...rows.map((r) => r.id));
  }

  const commentRows: (typeof ticketComments.$inferInsert)[] = [];
  const eventRows: (typeof ticketEvents.$inferInsert)[] = [];
  const tagLinkRows: (typeof ticketTags.$inferInsert)[] = [];
  const slaRows: (typeof slaInstances.$inferInsert)[] = [];

  pendingTickets.forEach((p, i) => {
    const ticketId = insertedIds[i]!;
    const base = p.row.createdAt!.getTime();
    for (const c of p.comments) {
      commentRows.push({
        ticketId, authorId: c.authorId, visibility: c.visibility,
        bodyText: c.bodyText, source: c.source, createdAt: new Date(base + c.offsetMs),
      });
    }
    for (const e of p.events) {
      eventRows.push({
        ticketId, actorId: e.actorId, actorType: e.actorType, eventType: e.eventType,
        field: e.field, oldValue: e.oldValue, newValue: e.newValue,
        createdAt: new Date(base + e.offsetMs),
      });
    }
    for (const tagId of p.tagIds) tagLinkRows.push({ ticketId, tagId });
    for (const s of p.sla) slaRows.push({ ...(s as any), ticketId });
  });

  console.log(`Inserting ${commentRows.length} comments, ${eventRows.length} events, ${slaRows.length} SLA instances…`);
  await insertChunked(ticketComments, commentRows);
  await insertChunked(ticketEvents, eventRows);
  await insertChunked(ticketTags, tagLinkRows);
  await insertChunked(slaInstances, slaRows);

  const open = pendingTickets.filter((p) => p.isOpen).length;
  const summary = {
    users: allUsers.length,
    agents: agents.length,
    queues: teamRows.length,
    tickets: TICKET_COUNT,
    open,
    closedOrResolved: TICKET_COUNT - open,
    slaWarningDemo: 6 - warningQuota,
    slaBreachedDemo: 3 - breachQuota,
    snoozed: pendingTickets.filter((p) => p.row.snoozedUntil).length,
    comments: commentRows.length,
    events: eventRows.length,
    kbArticles: KB_ARTICLES.length,
  };
  console.table(summary);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
