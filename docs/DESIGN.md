# METS — Master Electronics Ticketing System

**Design Document v0.1 — 2026-07-13**

A ServiceNow replacement for Master Electronics (<1000 employees), built as a
competition entry with a production trajectory. Working prototype + demo in
a one-week hackathon, solo build (Justin + Claude Code).

---

## 1. Executive summary

ServiceNow costs ~$300k/yr and is used for basic ticket management. Research
confirms this is typical: mid-market ITSM deals run $150–400k/yr, true cost is
higher with the 0.5–1.0 platform-admin FTE ServiceNow demands, plus 3–7% annual
price escalators.

METS replaces it with a purpose-built system:

- **One web app, one PostgreSQL database, one job runner.** At our scale
  (~500–3,000 tickets/month, ≈36k/yr) a single Postgres instance handles OLTP,
  full-text search, vector search, reporting, and the job queue. No
  Elasticsearch, no Redis, no Kafka. This is the cost and simplicity story.
- **AI where it earns its keep**: auto-categorization, routing, priority
  correction, thread summarization, suggested replies, KB recommendations —
  via the Claude API. Cost at our volume: **tens of dollars per month.**
- **A queue UX designed around how dispatchers actually work**: drag-and-drop
  assignment, mode buttons, ticket scoring, bulk actions, snooze — directly
  addressing today's ServiceNow pain points.
- **Estimated run cost: ~$5–8k/yr** (Azure App Service + Postgres Flexible
  Server + Blob storage + Claude API), vs $300k. Even the best commercial
  alternatives (HaloITSM ~$25k, ManageEngine ~$24k, Freshservice Pro ~$36–60k
  at 30–50 agents) cost 3–10× more per year and don't match the UX vision.

### Build vs buy (why custom)

| Option | Annual cost (≈30–50 agents) | Fit |
|---|---|---|
| ServiceNow (today) | ~$300k + admin FTE | Overkill; enhancements need specialist dev |
| Freshservice Pro | ~$36–60k + AI add-ons | Good ITSM fit, generic UX, price escalates |
| HaloITSM / ManageEngine Ent. | ~$24–40k | Cheapest full-ITIL commercial; dated UX |
| Jira Service Management Prem. | ~$18–31k | Developer-centric; marketplace-app sprawl |
| OSS (Zammad / GLPI / Znuny) | $0 license + hosting + admin | Zammad: no change mgmt. GLPI/Znuny: dated UX, steep config |
| **METS (build)** | **~$5–8k infra + AI** | Exact fit for our workflows, UX, and AI features |

The competition asks for something *simpler* and *more flexible* — the
research shows every off-the-shelf option trades one for the other. Building
lets us delete the complexity we never used (RITM/REQ split, CMDB, catalog
sprawl) instead of paying for it.

---

## 2. Pain points → features

| ServiceNow pain point | METS answer |
|---|---|
| Assigning tickets to yourself is clunky | One-click **Assign to Me** on every ticket row + drag onto your own avatar in Assign mode |
| Re-assigning to another group is painful | Drag ticket onto any queue (Move mode), or bulk-select → Move. AI suggests the correct queue when category looks wrong |
| Misplaced priority (low marked high, vice versa) | AI priority check on every inbound ticket: flags mismatches between stated priority and content, suggests correction with one-click accept |
| RITM and INC categories unnecessary; REQ ignored | **One ticket number space** (`T-10042`). `type` (incident / request / change) is just a field driving workflow differences, not a separate record class |
| Can't hide or delay tickets | **Snooze**: per-ticket, with wake date + reason, visible to leads (governance — snoozed ≠ vanished). Snoozed tickets leave your queue view and return automatically |
| (implicit) Wrong-category submissions | AI auto-categorization at creation; requester's category choice is a *hint*, not law |

---

## 3. Product design (UX)

### Visual identity
Master Electronics palette: **dark blue** primary, **grey/white** surfaces,
**orange** accents (CTAs, SLA warnings, drag highlights). Clean, dense,
information-first — an operator console, not a marketing site.

### Layout (three columns)
- **Menu bar at top**: logo, global search, nav (Queue / Dashboards / Knowledge
  Base / Admin), notifications, profile.
- **View tabs** below the menu bar: **All Tickets** · **My Queue** (my
  assigned) · **Triage** (AI suggestions inline — category, priority, queue;
  accept/reject per ticket or in bulk).
- **Left rail — agents**: agent cards with current load bar + expertise tags;
  drag tickets onto an agent to assign. Both rails are always visible, so
  drag-and-drop works in any direction without switching modes.
- **Right rail — actions**: *Assign to Me* and *Auto-Assign (AI)* drop cards,
  queue cards (drop to move), and the **Holding Area** (drop to snooze).
- **Ticket queue in center**: one row per ticket. Row shows number, type icon,
  title (truncated — **hover reveals full title**), requester, priority pill,
  **score**, age, SLA countdown, tags.
  - **Checkbox on every row** for mass selection → bulk action bar appears
    (assign, move, tag, snooze, close).
  - **Click expands the row in place**: description, comment thread, AI
    summary, suggested KB articles, activity trail, reply box.
  - **Drag handle** on every row; drop targets depend on active mode. A
    **Holding Area / Snooze** drop zone is always available at the rail bottom.
- **Sort control**: date (default), score, priority, requester, description,
  **random** (tie-breaker for fairness disputes).

### Ticket score & Ticket Points (TP)

Every open ticket gets a transparent, admin-tunable score:

```
score = priorityWeight        (P1=40, P2=25, P3=12, P4=5)
      + agePoints             (+2 per business day open, cap 20)
      + requesterWeight       (VIP/exec flag +15, manager +5)
      + slaProximity          (+10 inside warning window, +25 breached)
      + manualBoost           (lead-adjustable, ±10, logged)
```

Weights live in an admin config table — changing them is a form edit, not a
deployment (this is the "config changes without development effort"
requirement, applied everywhere).

**Ticket Points**: when a ticket resolves, the assignee banks TP equal to the
ticket's score at resolution. Dashboards show TP per agent per period —
recognizing that closing one gnarly P1 outweighs ten password resets.

*Gaming guards (design decision, v1):* TP is a **recognition metric, not a
compensation metric**; auto-assign and load caps prevent cherry-picking;
leads see TP alongside SLA attainment and reopen-rate so quantity-gaming is
visible. Revisit after real usage data.

### Tags vs queues

Research is unanimous: tickets with two owners have zero owners. So:
- **Owning queue is single** — one team is accountable (SLA and assignment
  logic require this).
- **Tags are free-form and unlimited** (`vpn`, `onboarding`, `project-x`).
  Saved tag views give the "assigned to multiple queues" *visibility* without
  the ownership ambiguity. Cross-team work uses linked/child tickets.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React SPA (Vite + TypeScript)                          │
│  queue board · dnd-kit drag/drop · dashboards · KB      │
└───────────────┬─────────────────────────────────────────┘
                │ REST + SSE (live queue updates)
┌───────────────┴─────────────────────────────────────────┐
│  Node API (Fastify + TypeScript) — single deployable    │
│  ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Tickets  │ │ Routing │ │ SLA      │ │ AI pipeline │  │
│  │ /KB /RBAC│ │ engine  │ │ engine   │ │ (Claude)    │  │
│  └──────────┘ └─────────┘ └──────────┘ └─────────────┘  │
│  Adapters:  Auth(dev|entra) Mail(mock|graph)            │
│             AI(claude|mock) Storage(local|azure-blob)   │
│  Jobs: pg-boss (in Postgres) — SLA sweep, AI enrich,    │
│        mail poll, user sync, matview refresh            │
└───────────────┬─────────────────────────────────────────┘
┌───────────────┴─────────────────────────────────────────┐
│  PostgreSQL 16  (single instance)                       │
│  OLTP · tsvector FTS · pg_trgm · pgvector · job queue   │
│  materialized views for reporting                       │
└─────────────────────────────────────────────────────────┘
   Azure Blob (attachments) · Claude API · MS Graph (prod)
```

**Stack**: React + Vite + TS front end; Fastify + TS API; PostgreSQL 16 with
`pgvector` + `pg_trgm`; `pg-boss` for background jobs; Drizzle (or Prisma)
ORM; `dnd-kit` for drag-and-drop. Azure App Service + Azure Database for
PostgreSQL Flexible Server in production; Docker Compose locally.

**Adapter pattern is the demo strategy.** Every external dependency sits
behind an interface with a real and a mock implementation, selected by config:

| Adapter | Demo mode | Production mode |
|---|---|---|
| Auth | Dev login (pick a user; real OIDC-shaped sessions) | Entra ID OIDC via MSAL |
| Mail | Mock inbox UI ("send an email" simulator) + seeded threads | Graph API: shared mailbox, change notifications, threading |
| AI | Claude API (**real in demo** — this is the showcase) | Same |
| Storage | Local disk | Azure Blob + SAS URLs |

This makes "here's exactly how it goes live" a config-file diff, not a
hand-wave — a judge-facing credibility point.

**Scale check**: 3k tickets/month × 10 years ≈ 360k tickets, single-digit
millions of event rows. Postgres aggregates that in well under a second with
sane indexes. Headroom to ~10× current volume with zero architectural change;
beyond that, read replicas and extracted services are available but almost
certainly never needed.

---

## 5. Data model (core)

Typed columns for everything the engine touches; JSONB for admin-defined
custom fields; append-only events for history.

```
tickets
  id bigint PK · number text (T-10042, from sequence)
  type enum(incident|request|change)
  subject · description
  status_id FK · priority smallint(1-4) · score int (computed, cached)
  requester_id FK · assignee_id FK? · queue_id FK
  category_id FK · source enum(portal|email|agent|api)
  snoozed_until timestamptz? · snooze_reason text?
  custom_fields jsonb · search tsvector (generated)
  created_at · updated_at · first_responded_at · resolved_at · closed_at
  legacy_number text?  -- ServiceNow crosswalk

statuses        id · name · category enum(new|open|pending|resolved|closed)
                -- admins add statuses ("Waiting on Vendor"→pending); ALL
                -- engine logic (SLA pause, reopen, reporting) keys off the
                -- 5 fixed categories. Zendesk's model — the right amount
                -- of flexibility, and how admins reconfigure without code.

ticket_comments  ticket_id · author_id · visibility enum(public|internal)
                 body_html · body_text · source · created_at
ticket_events    ticket_id · actor_id · actor_type(user|system|rule|ai)
                 event_type · field · old_value · new_value · created_at
                 -- append-only; written in-transaction by the service layer
                 -- (never triggers — "who did this" is the point).
                 -- Doubles as the activity feed. AI actions land here with
                 -- actor_type='ai' → auditable and revertible.
tags / ticket_tags · ticket_links (related|duplicate_of|child_of)
attachments      ticket_id · comment_id? · filename · content_type · size
                 storage_key · sha256
custom_field_definitions   name · type · options · required · applies_to
queues/teams · team_memberships(user_id, team_id, role member|lead)
users            synced from Entra: name·email·department·manager·vip flag
                 (manager powers approvals + VIP scoring); deactivate, never
                 delete (FK history)
skills · agent_skills(user_id, skill_id, level)
routing_rules    position · trigger · conditions jsonb · actions jsonb
sla_policies · business_calendars(+hours,+holidays) · sla_instances
kb_articles(+chunks w/ embeddings vector) · approvals
ai_enrichments   ticket_id · model · prompt_version · result jsonb ·
                 confidence jsonb · created_at
ai_usage         tokens per call (cost tracking)
```

Key decisions, with reasoning:
- **JSONB for custom fields, not EAV.** One write per update, GIN-indexable,
  reportable. `custom_field_definitions` is the schema; app layer validates.
  Standard fields never go in JSONB — anything SLA/routing/reporting touches
  gets a real column.
- **Comments and worknotes are one table split by `visibility`** — matches
  ServiceNow's comments/work_notes for clean migration. UI makes internal vs
  public unmistakable (the classic embarrassing-leak bug class).
- **Attachments in Blob storage, never in Postgres** (backup/WAL bloat).

---

## 6. Subsystem designs

### 6.1 Workflows: incident / request / change

One table, one number space. `type` selects a workflow overlay:
- **Incident**: default lifecycle, response+resolution SLAs.
- **Request**: same lifecycle, optionally a fulfillment checklist; no
  separate REQ/RITM objects, ever.
- **Change**: adds an approval stage — `approvals` table
  (ticket_id, approver_id, state, decided_at, note). v1: single-approver or
  simple chain (requester's manager → queue lead), auto-approve for
  pre-classified standard changes. Multi-stage CAB matrices are explicitly
  out of scope (that's the ServiceNow complexity we're deleting); revisit if
  real usage demands it.

Allowed status transitions per type live in a config table — admins edit
workflows in the UI, not in code.

### 6.2 Routing & assignment

- **Rules**: ordered `routing_rules` rows, first-match-wins with explicit
  stop (cascading triggers à la Zendesk confuse admins and create loops).
  Conditions = flat AND/OR over source/category/keywords/requester dept/VIP/
  custom fields; actions = set queue/priority/tags/assignee/notify. A small
  predicate interpreter over JSONB — **no embedded scripting language**.
  Every rule firing is logged to `ticket_events` (routing debuggability is
  the #1 admin complaint in every tool researched).
- **Assignment policies per queue**: `manual` (default) · `round_robin`
  (per-queue pointer, advisory-locked) · `load_based` (fewest open, RR
  tiebreak). Always: per-agent `max_open_assignments` cap + availability
  toggle; when everyone's capped, tickets stay unassigned-in-queue — never
  silently overload.
- **Expertise**: `agent_skills` seeded manually; enriched automatically from
  resolution history (agent closes N tickets in category X → suggest skill).
  *Assign by Expertise* filters eligible agents by required skill, then
  applies the queue policy.

### 6.3 AI pipeline (Claude API)

Async enrichment job on ticket create/major update — **never in the
synchronous create path**; AI fails soft, ticketing keeps working.

One structured-output call returns:
`{category, queue_suggestion, priority_suggestion, sentiment, summary, confidence{...}}`
stored in `ai_enrichments` with model + prompt_version provenance.

- **Confidence-gated tiers**: high → auto-apply (logged as actor_type=ai,
  one-click revert); medium → pre-filled suggestion in Triage mode; low →
  human triage. Thresholds tuned empirically against a labeled sample —
  LLM self-reported confidence is a ranking signal, not a probability.
- **Feedback loop from day one**: every agent correction of an AI decision is
  a labeled example; disagreement rate is a dashboard metric.
- **KB suggestions / similar tickets**: articles chunked (~400 tokens,
  heading-aware), embedded into pgvector. Hybrid retrieval = Postgres FTS +
  vector similarity merged with reciprocal-rank fusion (~100 lines). Top-3
  articles + similar *resolved tickets* in the expanded-ticket sidebar; same
  index powers requester-portal deflection ("before you submit…").
- **Summarize on handoff**: auto-summary when reassigned/escalated (where
  summaries earn their keep); cached by (ticket_id, last_comment_id).
- **Suggested replies**: drafted from retrieved KB chunks + thread, always
  agent-edited in v1, with citations; instructed to say "no relevant article"
  rather than improvise. Auto-send is a v3 decision.
- **Cost controls**: Haiku-class model for classification, prompt caching for
  the static category tree, thread truncation, per-day token budget with
  graceful degradation, `ai_usage` logging. Projected: **$30–80/month.**

### 6.4 SLA engine

- `sla_policies` (conditions → first_response/resolution targets + calendar)
  attach on create; `sla_instances` row per metric with **precomputed
  `target_at`** (business-minutes math done once, in the calendar's IANA
  timezone — DST is where homegrown SLA math dies; exhaustive tests).
- **Pause/resume keys off status *category***: entering `pending` pauses;
  leaving shifts `target_at` forward by paused business time.
- **Breach detection: 60-second sweep** — one indexed query over running
  instances past `target_at` / `warn_at`; idempotent warning + breach events
  (notify assignee, then lead; optionally bump priority → score rises →
  ticket climbs the queue). No per-ticket timers (cancel/reschedule
  minefield), no pure event-driven (breaches happen when nothing happens).
- Reopens resume (not reset) resolution SLA; priority changes carry elapsed
  time to the new instance. Compliance reporting reads `sla_instances`
  history — never reconstructed from timestamps.
- **Snooze does NOT pause SLA** (only pending-category statuses do). Hiding a
  ticket can't silently defuse its clock — this is the governance answer to
  "hide tickets" being a dangerous feature.

### 6.5 Email (production design; mock adapter in demo)

- Shared mailbox (helpdesk@) via Graph **application permissions scoped with
  RBAC for Applications** (unscoped Mail.Read grants every mailbox in the
  tenant — security team would rightly refuse).
- Change notifications = "go poll now" signal only; actual fetch lists
  unprocessed messages; `internetMessageId` dedup table (notifications
  duplicate; handlers must be idempotent). Subscriptions max ~7 days —
  scheduled renewal job + resubscribe on lifecycle events. 2–5 min fallback
  poll regardless.
- **Threading**: (1) store Message-ID of every mail sent/received keyed to
  ticket; match inbound In-Reply-To/References. (2) Fallback: `[T-10042]`
  subject token. (3) No conservative-fuzzy matching in v1 — false merges are
  worse than duplicates.
- **Loop prevention**: RFC 3834 headers outbound; drop auto-submitted inbound;
  never respond to self; circuit breaker (N mails/sender/ticket/M minutes →
  stop auto-acks, alert human).
- Quoted-history stripping on inbound HTML (~95% accurate; raw message always
  retrievable).

### 6.6 Auth & identity

- OIDC auth-code + PKCE via MSAL, confidential client. Demo: dev-login
  provider issuing identical session shapes (attempt real Entra app
  registration in week 1; it's a config swap either way).
- **Permissions live in the METS DB**, seeded by Entra group→role mapping:
  roles (admin/agent/requester/readonly) + team memberships (member|lead).
  Requesters see own (+dept) tickets; agents see their queues; **no
  per-ticket ACLs** (poisons every list query; queue-scoped visibility
  covers ITSM at this size).
- **User sync via Graph `/users/delta`** every 15–60 min (all ~1000 employees
  as requesters with department + manager before first login). SCIM is for
  multi-tenant SaaS; delta queries are simpler and debuggable.

### 6.7 Search & reporting

- **Search = Postgres only**: weighted tsvector (subject A, body B) + GIN;
  `pg_trgm` for partial ticket numbers and names; permission filter in the
  same SQL query (the killer argument vs a separate search engine, which
  breaks even around millions of docs — we're 100×  below).
- **Reporting**: live operational queries (open by queue/agent, SLA at-risk,
  today's inflow) + nightly materialized views for trends (created/resolved
  per day/team/category, FRT & MTTR as **medians/percentiles, never means**,
  SLA attainment, reopen rate, backlog age buckets, TP leaderboard).
  Time-in-status written at transition time (`ticket_status_durations`), not
  reconstructed. Power users get read-only SQL / Metabase — we don't build a
  report builder.

### 6.8 ServiceNow migration

Pipeline: REST Table API export → staging tables → transform/validate →
import, with a validation report (row counts, unmapped values, dangling refs).

- Export `incident`, `sc_req_item` (+`sc_request`/`sc_task` if needed),
  `sys_user`, `sys_user_group`, `kb_knowledge` with
  `sysparm_display_value=all` (raw + display values — reference fields are
  sys_ids, choice fields are backing ints; SN priority is *computed* from
  impact×urgency). Paginate ordered by `sys_created_on`.
- **Comments/work_notes are journal fields**, not columns: export
  `sys_journal_field` filtered by element ∈ {comments, work_notes} → maps
  1:1 to `ticket_comments` with public/internal visibility.
- Attachments via Attachment API (reassembles chunked legacy files); expect
  and log broken/zero-byte files; volume is 10–50× row data.
- KB HTML embeds images pointing at SN — download and rewrite or articles
  arrive broken. Migrate published latest versions only.
- **Scope (lesson from every failed migration studied): open tickets + last
  12–24 months at full fidelity; older history → read-only archive schema.**
  Unfiltered legacy data pollutes the new system and its AI features.
  `legacy_number` column + sys_id crosswalk table answers every future
  "where did INC0012345 go". Dry-run export for mapping validation, delta
  export at cutover, SN frozen read-only, parallel-run ≥1 month.
- **Pre-migration audit**: hunt for undocumented integrations riding on
  ServiceNow (identity/access provisioning is the classic landmine) — those
  move to Entra governance, not to METS.

---

## 7. Phased plan

### Production roadmap (the competition narrative)

| Phase | Scope | Exit criteria |
|---|---|---|
| **P1 — Core** | Tickets, comments, queues, RBAC, queue UI (drag/drop, modes, score, snooze, bulk), dev auth | Agents run daily work end-to-end on seeded data |
| **P2 — Intelligence** | AI enrichment pipeline, Triage mode, KB + hybrid retrieval, suggested replies, similar tickets | AI categorizes real sample tickets ≥ agreed accuracy; corrections captured |
| **P3 — Operations** | SLA engine + calendars + breach alerts, routing rules UI, dashboards/matviews, TP leaderboard | SLA attainment reportable; rules editable by non-devs |
| **P4 — Connect** | Entra SSO live, Graph email two-way, user delta sync, approvals for changes | Email→ticket→reply round-trip in prod tenant |
| **P5 — Cutover** | Migration tooling, dry run, validation report, parallel run, go-live | SN read-only; METS system of record |

### One-week hackathon sprint (solo + Claude Code)

- **D1**: scaffold (monorepo, Docker Compose Postgres, schema, migrations,
  seed generator: ~800 realistic tickets, 15 agents, 6 queues, KB articles)
- **D2–3**: queue UI — the centerpiece. Rows, expand-in-place, hover titles,
  checkboxes/bulk bar, sort options, drag-and-drop with mode buttons
  (My Queue / Assign / Move / Triage), snooze drop zone, scoring live
- **D4**: AI pipeline (real Claude API): auto-categorize, priority check,
  queue suggestion, summaries — wired into Triage mode
- **D5**: SLA engine (single default business calendar) + seeded near-breach
  tickets (demo gold: watch one cross its warning threshold live); routing
  rules + round-robin assignment
- **D6**: dashboards (volume, MTTR median, SLA attainment, backlog age, TP
  leaderboard); KB with hybrid search + suggested articles/replies; mock
  email inbox simulator if on schedule
- **D7**: admin screens (statuses, score weights, rules — proving no-code
  configurability), seed-data realism pass, demo script, cost one-pager

**Real in demo**: queue UX, scoring/TP, AI (live Claude calls), SLA engine,
routing, dashboards, KB search, admin config.
**Simulated behind production-shaped adapters**: email (mock inbox), SSO
(dev-login), migration (described in proposal; import wizard is a stretch
goal).
**Cut order if slipping**: mock email simulator → suggested replies → rules
UI → dashboards degrade to seeded visuals. The queue UI and AI triage are
never cut — they are the demo.

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| 1-week scope slip | Queue UI + AI are the demo; SLA/dashboards degrade to seeded visuals if needed. Cut order: email simulator → suggested replies → rules UI → dashboards |
| Drag-and-drop complexity eats week 1 | dnd-kit, not hand-rolled; modes = same board, different drop targets |
| AI demo flakes live | Cache enrichments for seeded tickets; live calls only in the "new ticket" demo moment; mock adapter as stage fallback |
| TP gaming concerns from judges | Framed as recognition metric with explicit guards (§3); shows design maturity |
| "Who maintains this?" judge question | Monolith + one DB + adapter seams; P4/P5 phases show the ops story; compare vs ServiceNow's dedicated-admin FTE |

**Open design questions (answers welcome, defaults chosen):**
1. Score weights and the TP framing — defaults above OK, or tune before demo?
2. Snooze governance — leads see all snoozed tickets (default), or also a max
   snooze duration?
3. Change approvals — single approver (manager) in v1 (default), or demo a
   two-step chain?
4. Ticket number format — `T-10042` (default) vs typed prefixes
   (`INC-`/`REQ-`) which the pain points suggest killing?
5. Demo data — generate synthetic Master-Electronics-flavored tickets
   (default), or can you export a real anonymized ServiceNow sample?

---

*Research backing this design: `docs/research/landscape.md` (market/pricing)
and `docs/research/architecture-notes.md` (engineering patterns).*
