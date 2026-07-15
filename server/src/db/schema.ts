import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums — fixed system vocabularies. Admin-configurable things (statuses,
// categories, queues) are tables, not enums. See docs/DESIGN.md §5.
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['admin', 'agent', 'requester', 'readonly']);
export const teamRole = pgEnum('team_role', ['member', 'lead']);
export const statusCategory = pgEnum('status_category', ['new', 'open', 'pending', 'resolved', 'closed']);
export const ticketType = pgEnum('ticket_type', ['incident', 'request', 'change']);
export const ticketSource = pgEnum('ticket_source', ['portal', 'email', 'agent', 'api']);
export const commentVisibility = pgEnum('comment_visibility', ['public', 'internal']);
export const actorType = pgEnum('actor_type', ['user', 'system', 'rule', 'ai']);
export const linkType = pgEnum('link_type', ['related', 'duplicate_of', 'child_of']);
export const assignmentPolicy = pgEnum('assignment_policy', ['manual', 'round_robin', 'load_based']);
export const ruleTrigger = pgEnum('rule_trigger', ['ticket_created', 'ticket_updated']);
export const slaMetric = pgEnum('sla_metric', ['first_response', 'resolution']);
export const slaState = pgEnum('sla_state', ['running', 'paused', 'completed', 'breached']);
export const kbStatus = pgEnum('kb_status', ['draft', 'published', 'archived']);
export const approvalState = pgEnum('approval_state', ['pending', 'approved', 'rejected']);

// Human-facing ticket numbers: T-1000042 (7 digits). Single number space by
// design — incident/request/change is a field, not a record class.
export const ticketNumberSeq = pgSequence('ticket_number_seq', { startWith: 1000000 });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entraId: text('entra_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    department: text('department'),
    location: text('location'), // site name, or 'Remote'
    managerId: bigint('manager_id', { mode: 'number' }),
    role: userRole('role').notNull().default('requester'),
    isVip: boolean('is_vip').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true), // deactivate, never delete
    isAvailable: boolean('is_available').notNull().default(true), // agent OOO toggle
    // 'all' = sees every queue; 'own' = ticket list/detail restricted to
    // the queues their teams own (admin-controlled).
    queueVisibility: text('queue_visibility').notNull().default('all'),
    maxOpenAssignments: integer('max_open_assignments').notNull().default(25),
    // { assignedToMe, slaAlerts, queueActivity, emailReplies } — all default true
    notificationPrefs: jsonb('notification_prefs'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const teams = pgTable('teams', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  assignmentPolicy: assignmentPolicy('assignment_policy').notNull().default('manual'),
  lastAssignedUserId: bigint('last_assigned_user_id', { mode: 'number' }), // round-robin pointer
  // Comma-separated addresses emailed whenever a ticket enters this queue.
  notifyEmails: text('notify_emails'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMemberships = pgTable(
  'team_memberships',
  {
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    teamId: bigint('team_id', { mode: 'number' }).notNull().references(() => teams.id),
    role: teamRole('role').notNull().default('member'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
);

export const skills = pgTable('skills', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
});

export const agentSkills = pgTable(
  'agent_skills',
  {
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    skillId: bigint('skill_id', { mode: 'number' }).notNull().references(() => skills.id),
    level: smallint('level').notNull().default(1), // 1-3
    // 'auto' = derived from resolution history (re-synced periodically, may be
    // revoked when it no longer qualifies); 'manual' = admin-assigned, never
    // touched by the sync.
    source: text('source').notNull().default('manual'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

// ---------------------------------------------------------------------------
// Ticket taxonomy — admin-editable without code (DESIGN.md §5)
// ---------------------------------------------------------------------------

export const statuses = pgTable('statuses', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
  // All engine logic (SLA pause, reopen, reporting) keys off category,
  // never off individual statuses. Admins add statuses freely.
  category: statusCategory('category').notNull(),
  position: integer('position').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
});

export const categories = pgTable('categories', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  parentId: bigint('parent_id', { mode: 'number' }),
  // Descriptions + examples feed the AI classification prompt.
  description: text('description'),
  // Request-type tickets landing here park at intake until the requester's
  // manager approves (equipment, licenses, …). Admin-togglable.
  requiresApproval: boolean('requires_approval').notNull().default(false),
});

export const tags = pgTable('tags', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
});

export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  type: text('type').notNull(), // text | number | select | multiselect | date | boolean
  options: jsonb('options'),
  required: boolean('required').notNull().default(false),
  appliesTo: jsonb('applies_to'), // { types?: [], queueIds?: [] }
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    number: text('number')
      .notNull()
      .default(sql`'T-' || nextval('ticket_number_seq')`),
    type: ticketType('type').notNull().default('incident'),
    subject: text('subject').notNull(),
    description: text('description').notNull().default(''),
    statusId: bigint('status_id', { mode: 'number' }).notNull().references(() => statuses.id),
    priority: smallint('priority').notNull().default(3), // 1 (highest) - 4
    score: integer('score').notNull().default(0), // cached; recomputed by scoring job
    requesterId: bigint('requester_id', { mode: 'number' }).notNull().references(() => users.id),
    // Set only when someone filed the ticket for another user — the ticket
    // belongs to the requester (their VIP status, location, SLA); this is
    // who actually typed it in.
    submittedById: bigint('submitted_by_id', { mode: 'number' }).references(() => users.id),
    assigneeId: bigint('assignee_id', { mode: 'number' }).references(() => users.id),
    queueId: bigint('queue_id', { mode: 'number' }).notNull().references(() => teams.id), // single owning queue
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    source: ticketSource('source').notNull().default('portal'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }), // hides from queue views; SLA unaffected
    snoozeReason: text('snooze_reason'),
    manualBoost: integer('manual_boost').notNull().default(0), // lead-adjustable score nudge, ±10
    customFields: jsonb('custom_fields').notNull().default({}),
    legacyNumber: text('legacy_number'), // ServiceNow crosswalk
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // CSAT: requester rates 1–5 once the ticket is resolved/closed.
    csatRating: smallint('csat_rating'),
    csatComment: text('csat_comment'),
    csatAt: timestamp('csat_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tickets_number_idx').on(t.number),
    index('tickets_queue_status_idx').on(t.queueId, t.statusId),
    index('tickets_assignee_idx').on(t.assigneeId),
    index('tickets_created_idx').on(t.createdAt),
  ],
);

export const ticketTags = pgTable(
  'ticket_tags',
  {
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    tagId: bigint('tag_id', { mode: 'number' }).notNull().references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.tagId] })],
);

export const ticketLinks = pgTable(
  'ticket_links',
  {
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    linkedTicketId: bigint('linked_ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    type: linkType('type').notNull().default('related'),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.linkedTicketId, t.type] })],
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    authorId: bigint('author_id', { mode: 'number' }).notNull().references(() => users.id),
    visibility: commentVisibility('visibility').notNull().default('public'),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    source: ticketSource('source').notNull().default('agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_comments_ticket_idx').on(t.ticketId)],
);

// Append-only. Written by the service layer in the same transaction as the
// change — never by triggers. Doubles as the ticket activity feed; AI actions
// land here with actorType='ai' so they are auditable and revertible.
export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    actorId: bigint('actor_id', { mode: 'number' }).references(() => users.id),
    actorType: actorType('actor_type').notNull().default('user'),
    eventType: text('event_type').notNull(), // created | status_changed | assigned | moved | ...
    field: text('field'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt)],
);

// Written at each status transition; reporting reads this, never reconstructs
// time-in-status from the event log.
export const ticketStatusDurations = pgTable(
  'ticket_status_durations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    statusId: bigint('status_id', { mode: 'number' }).notNull().references(() => statuses.id),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull(),
    exitedAt: timestamp('exited_at', { withTimezone: true }),
  },
  (t) => [index('tsd_ticket_idx').on(t.ticketId)],
);

export const attachments = pgTable('attachments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
  commentId: bigint('comment_id', { mode: 'number' }).references(() => ticketComments.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(), // bytes live in blob/local storage, never in Postgres
  sha256: text('sha256').notNull(),
  uploadedBy: bigint('uploaded_by', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = pgTable('approvals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
  approverId: bigint('approver_id', { mode: 'number' }).notNull().references(() => users.id),
  state: approvalState('state').notNull().default('pending'),
  note: text('note'),
  // Where the ticket goes when approved (the queue triage picked before the
  // ticket was parked at intake).
  targetQueueId: bigint('target_queue_id', { mode: 'number' }).references(() => teams.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  // Who actually decided — an admin may act on the approver's behalf.
  decidedById: bigint('decided_by_id', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Routing & SLA
// ---------------------------------------------------------------------------

export const routingRules = pgTable('routing_rules', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  trigger: ruleTrigger('trigger').notNull().default('ticket_created'),
  // Flat AND/OR predicate groups interpreted by the rules engine — no
  // embedded scripting. First matching rule wins; firing is logged to
  // ticket_events.
  conditions: jsonb('conditions').notNull(),
  actions: jsonb('actions').notNull(),
});

// Canned responses with {{variable}} substitution. autoRespond templates fire
// as public SOTO Bot comments: categoryId null = acknowledgment on every new
// ticket; categoryId set = auto-reply when a ticket lands in that category
// (and it completes the first-response SLA — an ack does not).
export const responseTemplates = pgTable('response_templates', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
  autoRespond: boolean('auto_respond').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const slaPolicies = pgTable('sla_policies', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').notNull(), // matched against ticket at create
  firstResponseMinutes: integer('first_response_minutes'),
  resolutionMinutes: integer('resolution_minutes'),
  // Hackathon: one implicit default business calendar (Mon-Fri 8-17, config
  // table). Production: per-policy calendar FK.
});

export const slaInstances = pgTable(
  'sla_instances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    policyId: bigint('policy_id', { mode: 'number' }).notNull().references(() => slaPolicies.id),
    metric: slaMetric('metric').notNull(),
    state: slaState('state').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // Precomputed absolute deadline (business-hours math done at write time);
    // recomputed when a pending-category pause ends. The 60s sweep indexes on
    // these — never computed at read time.
    targetAt: timestamp('target_at', { withTimezone: true }).notNull(),
    warnAt: timestamp('warn_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    accumulatedPausedSeconds: integer('accumulated_paused_seconds').notNull().default(0),
    warnedAt: timestamp('warned_at', { withTimezone: true }),
    breachedAt: timestamp('breached_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('sla_running_target_idx').on(t.state, t.targetAt)],
);

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export const kbArticles = pgTable('kb_articles', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: text('title').notNull(),
  bodyText: text('body_text').notNull(),
  bodyHtml: text('body_html'),
  status: kbStatus('status').notNull().default('draft'),
  authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
  // Set when AI drafted this from a resolved ticket.
  sourceTicketId: bigint('source_ticket_id', { mode: 'number' }).references(() => tickets.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Heading-aware ~400-token chunks; hybrid retrieval = FTS + vector w/ RRF.
// 384 dims = all-MiniLM-L6-v2 via transformers.js (local, no API dependency).
export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    articleId: bigint('article_id', { mode: 'number' }).notNull().references(() => kbArticles.id),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 384 }),
  },
  (t) => [index('kb_chunks_article_idx').on(t.articleId)],
);

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const aiEnrichments = pgTable(
  'ai_enrichments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    feature: text('feature').notNull().default('triage'), // triage | summary
    // pending → applied/dismissed/corrected by an agent; auto_applied when
    // confidence cleared the threshold. Agent decisions are the labeled
    // feedback loop — corrections are injected into future triage prompts.
    status: text('status').notNull().default('pending'),
    // { original: {category, queueSlug, priority}, corrected: {...}, byUserId, at }
    feedback: jsonb('feedback'),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    result: jsonb('result').notNull(), // {category, queueSlug, priority, sentiment, summary}
    confidence: jsonb('confidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_enrichments_ticket_idx').on(t.ticketId)],
);

export const aiUsage = pgTable('ai_usage', {
  // True for demo-baseline rows the seeder synthesizes; real usage rows
  // (false) are preserved across reseeds so spend history keeps accruing.
  seeded: boolean('seeded').notNull().default(false),
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  feature: text('feature').notNull(), // classify | summarize | draft_reply | embed
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  ticketId: bigint('ticket_id', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// App config — admin-tunable knobs (score weights, business hours, thresholds)
// live here so changing them is a form edit, not a deployment.
// ---------------------------------------------------------------------------

// Recurring tickets: preventive maintenance, cert renewals, access reviews.
// A sweep files each definition through the normal intake pipeline (routing,
// SLA, AI triage) when next_run_at comes due, then advances the date.
export const recurringTickets = pgTable('recurring_tickets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  type: ticketType('type').notNull().default('request'),
  frequency: text('frequency').notNull(), // daily | weekly | monthly | quarterly
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  requesterId: bigint('requester_id', { mode: 'number' }).notNull().references(() => users.id),
  createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Follow any ticket: watchers get bell notifications for every event and
// public comment on it, regardless of assignment or queue membership.
export const ticketWatchers = pgTable(
  'ticket_watchers',
  {
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull().references(() => tickets.id),
    userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })],
);

// Agent-to-agent DMs. Polling-based (no socket infra) — the web client
// refetches on a short interval, which is plenty for an internal tool.
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fromId: bigint('from_id', { mode: 'number' }).notNull().references(() => users.id),
    toId: bigint('to_id', { mode: 'number' }).notNull().references(() => users.id),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_from_to_idx').on(t.fromId, t.toId, t.id),
    index('chat_to_unread_idx').on(t.toId, t.readAt),
  ],
);

// Outbound mail. The mock adapter writes rows here (the Email simulator
// reads them); the Graph adapter sends for real and still records the row.
export const mailOutbound = pgTable(
  'mail_outbound',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    kind: text('kind').notNull().default('notification'),
    ticketId: bigint('ticket_id', { mode: 'number' }).references(() => tickets.id),
    // e.g. queue:<queueId>:<ticketId> — one notification per ticket per queue
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mail_outbound_to_idx').on(t.toEmail, t.id), index('mail_outbound_dedupe_idx').on(t.dedupeKey)],
);

// Public-API keys: hashed secret, bound to a METS user so the key inherits
// that user's role and queue visibility (a readonly user = read-only key).
export const apiKeys = pgTable('api_keys', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(), // "Power BI extract", "Warehouse kiosk"
  keyHash: text('key_hash').notNull(), // sha256 of the secret — never stored raw
  prefix: text('prefix').notNull(), // first chars, for display: mets_a1b2…
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
  createdBy: bigint('created_by', { mode: 'number' }).notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
