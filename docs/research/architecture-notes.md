# Research: Engineering Patterns for a Production Ticketing System

*Compiled 2026-07-13. Full engineering brief backing `docs/DESIGN.md` §4–6.
Scale: ~1000 employees, 30–100 agents, 500–3000 tickets/month.*

**Scale reality:** 3000 tickets/month ≈ 36k/yr ≈ 180k over 5 years; with ~10
comments/audit rows each, low single-digit millions of rows. One Postgres
instance covers OLTP, search, vectors, reporting, and the job queue. No
Kafka/Elasticsearch/Redis-as-primary-anything.

## 1. Core data model

- **Typed columns for standard fields** (queried/indexed/reported constantly); human ticket number from a sequence, never expose raw PK.
- **Statuses**: `statuses` table with fixed system `category` enum (`new|open|pending|resolved|closed`). Admins add statuses; engine logic keys off categories. Zendesk's model — right amount of flexibility without building a workflow engine (accidentally rebuilding ServiceNow, badly).
- **Custom fields: JSONB, not EAV.** EAV = self-join piles, write amplification, miserable reporting. JSONB = one write, GIN/expression indexes, queryable. `custom_field_definitions` table is the schema; validate in app layer. Refs: [EAV→JSONB](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/), [JSONB vs EAV](https://www.razsamuel.com/postgresql-jsonb-vs-eav-dynamic-data/), [anti-patterns](https://www.enterprisedb.com/blog/postgresql-anti-patterns-unnecessary-jsonhstore-dynamic-columns). Never dump *standard* fields into JSONB.
- **Audit trail**: append-only `ticket_events` written from the service layer in the same transaction — not DB triggers (triggers lose actor/business context). Doubles as activity feed.
- **Comments**: one table, `visibility` enum (`public|internal`) — matches SN comments/work_notes for migration. Store body_html + body_text. Make internal-vs-public visually unmistakable (leak bug class).
- **Attachments**: metadata row + bytes in Azure Blob (bytea bloats backups/WAL); sha256 dedup; short-lived SAS URLs; block executable extensions inbound.
- **Owning queue is single**; tags for cross-cutting visibility; child/linked tickets for genuine multi-team work. True multi-queue membership creates ownership ambiguity — every system allowing it regrets it.

## 2. SLA engine

- Tables: `sla_policies` (conditions → targets + calendar), `business_calendars` (+hours/holidays, per-team, IANA timezones), `sla_instances` (per ticket per metric: started/paused/accumulated-pause/target_at/warned_at/breached_at/state).
- **Precompute `target_at` as absolute timestamp** via one well-tested `add_business_minutes(ts, mins, calendar)` function. Test holiday spans, weekend starts, **DST transitions** (where homegrown SLA math dies — compute in calendar's IANA tz, not UTC offsets).
- **Pause/resume off status category**; on resume, shift `target_at` forward by paused business time (Zendesk/SN behavior — [Zendesk SLA pause](https://support.zendesk.com/hc/en-us/articles/4408825745690)). Beats tick-counters (drift) and read-time computation (can't index "what breaches next").
- **Breach detection: 60s scheduled sweep** (`WHERE state='running' AND target_at < now()`), idempotent warnings via `warned_at IS NULL`. Not per-ticket delayed jobs (cancel/reschedule minefield), not pure event-driven (breaches happen when nothing happens). Sweep re-verifies state before declaring breach.
- Policies: reopen resumes (not resets) resolution SLA; priority change → cancel old instance, start new with elapsed carried; report from `sla_instances` history only.

## 3. Email (Microsoft 365 / Graph)

- Shared mailbox + app registration with **application permissions scoped via RBAC for Applications** — unscoped `Mail.Read`/`Mail.Send` grants every tenant mailbox ([permissions ref](https://learn.microsoft.com/en-us/graph/permissions-reference), [RBAC for apps](https://office365itpros.com/2026/02/17/mail-send-rbac-for-applications/)).
- Subscribe to change notifications on the inbox; **max lifetime ~7 days, no auto-renew** — daily renewal job + resubscribe on lifecycle notifications ([overview](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview), [subscription lifetimes](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)). Delegated `.Shared` permissions don't support subscriptions — use application permissions.
- **Notification = "go poll now" signal only**; fetch unprocessed messages; `internetMessageId` dedup table mandatory (notifications duplicate; be idempotent). Webhook endpoint: validationToken handshake, 202 in <3s, enqueue don't process. 2–5 min fallback poll.
- **Threading priority**: (1) stored Message-IDs vs In-Reply-To/References ([threading](https://www.mailersend.com/blog/email-threading)); (2) `[T-10042]` subject token fallback (Salesforce-style — [E2C threading](https://help.salesforce.com/s/articleView?id=service.support_email_to_case_threading.htm)); (3) fuzzy match conservative or disabled — false merges worse than duplicates.
- Outbound via Graph sendMail as the shared mailbox; set In-Reply-To/References so requester clients thread; send from the same address that receives.
- **Loop prevention (all of)**: `Auto-Submitted: auto-generated` + `X-Auto-Response-Suppress: All` outbound; drop inbound auto-submitted/bulk; never respond to self; per-sender rate circuit breaker (catches OOO bots that ignore headers).
- Strip quoted history from HTML replies (Talon-style regexes, ~95%); keep raw message retrievable.

## 4. Auth & identity

- OIDC auth-code + PKCE via MSAL, confidential client; validate server-side.
- **RBAC in app DB**, Entra groups as coarse input via mapping table: global roles + `team_memberships(member|lead)`. No per-ticket ACLs (poisons list queries).
- **User sync: Graph `/users/delta`** 15–60 min (initial full, then deltaLink; `@removed` → deactivate, never delete). Sync department/officeLocation/manager (routing + approvals + VIP). SCIM = you implement a SCIM server, Entra pushes on its schedule — right for multi-tenant SaaS, overkill here ([delta users](https://learn.microsoft.com/en-us/graph/delta-query-users), [SCIM ref](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/entra-id-scim-api-reference)).
- Pitfalls: groups-overage claim (>200 groups) — resolve via Graph or app roles; filter service accounts by `accountEnabled`/type.

## 5. Routing & assignment

- Ordered `routing_rules(position, trigger, conditions jsonb, actions jsonb)`; **first-match-wins with explicit stop** (cascading triggers confuse + loop). Small predicate interpreter; no embedded scripting; log rule firings to `ticket_events` (debuggability = #1 admin complaint).
- Per-queue assignment policy: manual (default — many internal IT teams prefer dispatch) · round_robin (per-queue pointer) · load_based (fewest open, RR tiebreak). Always: `max_open_assignments` cap + availability toggle; fall back to unassigned — never silently overload.
- Skills: `skills` + `agent_skills(level)`; build tables early, ship skills-based assignment v2 once the AI classifier produces reliable categories.
- Concurrency: `pg_advisory_xact_lock(queue_id)` around the round-robin pointer.

## 6. AI workflows (2025–2026 patterns)

- **Async enrichment job** on create/update; one structured-output call → `{category, priority_suggestion, sentiment, summary, confidence, pii_flags}`; store with model + prompt_version provenance. Never in the synchronous create path; fail soft.
- **Confidence-gated tiers**: high → auto-apply (audit event, revertible); mid → one-click suggestion; low → human. LLM self-reported confidence is poorly calibrated — treat as ranking signal, set thresholds empirically ([calibration discussion](https://aclanthology.org/2025.uncertainlp-main.16.pdf)). Feedback loop from day one: agent corrections = labeled examples; monthly disagreement review. Category tree with descriptions + 2–3 examples each in prompt beats fine-tuning at this volume.
- **KB retrieval**: chunk ~300–500 tokens heading-aware; embed to pgvector; **hybrid FTS + vector with reciprocal-rank fusion** (~100 lines — [hybrid RRF](https://dev.to/gabrielanhaia/hybrid-search-in-100-lines-bm25-pgvector-with-rrf-merge-58cn), [pgvector hybrid](https://www.instaclustr.com/education/vector-database/pgvector-hybrid-search-benefits-use-cases-and-quick-tutorial/)). Embed resolved tickets too — "similar past tickets + resolutions" often beats KB articles. Same index: agent sidebar, portal deflection, AI grounding.
- **Summarization**: on-demand + auto on reassignment/escalation (handoffs are where summaries earn keep); cache by (ticket_id, last_comment_id).
- **Suggested replies**: grounded in retrieved chunks, cited, agent-edited v1; instruct "no relevant article found" over improvising. Auto-send = v3 after edit-distance data.
- **Cost**: 3000 tickets/mo × (classify + embed + occasional summarize/draft) on Haiku-class models = **tens of $/month**. Controls: small models default, thread truncation, prompt caching for static category tree, per-day token budget with graceful degradation, `ai_usage` log.

## 7. Reporting

- Worst case 360k tickets / 5–10M event rows in a decade — Postgres aggregates in <1s with `(team_id, created_at)`, `(status, team_id)`, partial index on open tickets. No warehouse/OLAP.
- Live views (dashboards) = direct queries, real-time. Trends = nightly/hourly `REFRESH MATERIALIZED VIEW CONCURRENTLY`: created/resolved per day/team/category, FRT & MTTR via `percentile_cont` (**medians/percentiles, never means** — one 3-week vendor ticket wrecks a mean), SLA attainment, reopen rate, backlog age buckets.
- Two schema decisions enabling reporting later: `sla_instances` history (attainment from records, not reconstruction) and `ticket_status_durations` written at transition time.
- Power users: read-only replica/matviews + Metabase/Grafana — don't build a report builder.

## 8. Search

- **Postgres only**: weighted generated tsvector (subject A, body B) + GIN; per-comment search docs joined back; `ts_rank`; **visibility predicate in the same query** (permission-filtered search is far easier in-DB). `pg_trgm` GIN for substring/typo matching on subject, requester, partial ticket numbers.
- Dedicated engine break-even ≈ millions of docs or search-as-product ([Neon comparison](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch), [ParadeDB](https://www.paradedb.com/blog/elasticsearch-vs-postgres)) — we're ~10⁵. If outgrown: pg_search/ParadeDB/Meilisearch bolt on without redesign.
- Non-English offices: `simple` config + trigram as safe default; remember tsvector backfill on weighting changes.

## 9. ServiceNow migration

- **Table API**: `GET /api/now/table/{incident|sc_req_item|sc_request|sc_task|sys_user|sys_user_group|kb_knowledge}`; paginate `sysparm_limit`+`offset` **ordered by sys_created_on** (unordered pagination skips/dupes — [KB0727636](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0727636)); pages 500–1000; mind semaphore limits.
- **`sysparm_display_value=all`** — reference fields return sys_ids, choice fields raw ints (`state`=1,2,3,6,7…); SN priority is *computed* from impact×urgency. Build sys_choice-derived mappings + sys_id→email map; decide fallback for deactivated users' dangling refs.
- **Comments/work_notes are journal fields, not columns** — plain GET returns empty. Export `sys_journal_field` filtered `name=incident`, `element ∈ {comments, work_notes}` → author/timestamp/value rows map 1:1 to comments with visibility ([KB0860915](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0860915), [walkthrough](https://timdietrich.me/blog/servicenow-table-api-comments-work-notes/)). May need ACL/REST exposure enabled. Skip `sys_audit` (huge) — keep SN read-only for retention instead.
- **Attachments**: enumerate `sys_attachment` by table_name+table_sys_id; download via Attachment API `GET /api/now/attachment/{sys_id}/file` (reassembles chunked `sys_attachment_doc` legacy files — [Attachment API](https://www.servicenow.com/docs/r/api-reference/rest-apis/c_AttachmentAPI.html)). Expect broken/zero-byte legacy files (log+skip); volume 10–50× row data.
- **KB**: `kb_knowledge.text` HTML embeds images pointing at SN — download + rewrite or articles arrive broken. Published latest versions only.
- **Plan**: open + last 12–24 months full fidelity; older → read-only archive schema. `legacy_number` + sys_id crosswalk table. Dry-run full export → mapping validation; delta (`sys_updated_on >`) at go-live; freeze SN read-only; no bidirectional sync.

## Cross-cutting build order (opinionated)

1. Tickets + comments + audit + auth/user sync
2. Email in/out (hardest subsystem — start early in production track)
3. Queues, routing, assignment
4. SLA engine
5. Search + reporting
6. AI enrichment + KB retrieval
7. Migration tooling in parallel from step 1 (staging imports exercise the data model and find design errors cheaply)
