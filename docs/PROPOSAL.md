# METS — Proposal (v2.1)

**Problem #4: Ticketing System Replacement · Team Rhoda**

*(v1.0 preserved as PROPOSAL-v1.0.md; this revision separates what runs
today from what a pilot requires, and replaces the headline savings claim
with three-year scenarios.)*

## The problem

We pay **~$300,000/year** for ServiceNow and use it for basic ticket
management. Enhancements need specialist development; agents fight the tool
(self-assignment, re-queuing, mis-set priorities, RITM/REQ noise).

## The solution

**METS** — a purpose-built ticketing system: one web app, one PostgreSQL
database. Postgres handles transactions, full-text search, vector search,
and reporting at our scale (~36k tickets/yr). AI (Claude API) does the
triage humans hate — and every AI action is audited, confidence-gated, and
one click to revert.

| | ServiceNow today | METS |
|---|---|---|
| Annual software cost | ~$300,000 + escalators | ~$8k infra + AI (see TCO below for the honest total) |
| Admin burden | Specialist dev for changes | Admin UI: weights, SLAs, statuses, rules, keywords, gates, templates |
| AI | Paid add-ons | Built in — nine audited workflows: triage (reads screenshots), deflection, incident detection, KB drafting, guided intake, bilingual tickets, weekly briefing, NL search, draft replies |
| Queues | 52 (per-site sprawl) | **17** + site/function tags |

## Maturity, honestly

Everything in the demo video is real and running against 800 seeded tickets
plus live Claude calls — nothing is mocked on screen except the mail
*transport*. But "runs in a demo" and "ready for your HR ticket" are
different bars. Here is where each capability actually stands:

**Live in the demo today**
- Queue board: drag-and-drop assign/re-queue, bulk actions, snooze, full audit trail on every change
- AI triage (reads attached screenshots, writes missing subjects) with per-field confidence gates, agent corrections that become routing patterns, and honest deferral below threshold
- AI extras: suspected-incident detection with parent/child linking + broadcast updates, self-service deflection (SOTO offers the KB fix at intake; "solved" closes with zero agent involvement), KB article drafting from resolutions (human-reviewed before publish), guided intake for Databricks access, bilingual tickets (translated both directions), weekly problem briefing, natural-language queue search, on-behalf-of detection
- ServiceNow CSV import: auto-mapped preview, idempotent runs, legacy INC numbers preserved and searchable — exercised against sample exports
- Public REST API (admin-minted keys acting under full RBAC, OpenAPI docs at /api/docs), recurring ticket schedules, VIP lists (global and per-queue)
- SLA engine: business-hours math, pause on pending, breach → score escalation; configurable per-priority targets
- Scoring: priority/age/VIP/SLA/keyword/sentiment weights, all admin-tunable with instant rescore (including the ALL-CAPS penalty)
- Requester portal with server-side role enforcement, CSAT ratings, reply-to-reopen
- Manager approvals (category gates + org chart), response templates + auto-respond, agent chat with ticket links, watchers, merge-duplicates with exact part-number guard, escalation sweep, queue email notifications
- Attachments: images and files on tickets (type allowlist, size caps, authenticated access mirroring ticket visibility) — local-disk adapter today, Azure Blob is the production swap; malware scanning is a pilot item
- Dashboards: volume, median MTTR/FRT, SLA attainment, CSAT, TP leaderboard, AI accuracy scoreboard (routing accuracy vs human judgment, per-call cost by feature, total spend)
- Admin UI for all of the above — zero-code configuration, demonstrated live

**Built and dormant (activation is configuration, not code)**
- Entra ID SSO: token validation, user mapping, auto-provisioning, sign-in UI — needs only an app registration (blocked on admin rights; activation checklist in docs/SSO.md)

**Designed and documented, not yet built**
- Microsoft Graph inbound mail (the pipeline — threading, guest contacts, auto-ack, reopen — runs today against the simulated transport; an SMTP *outbound* adapter is built with per-message delivery audit, and direct send is blocked by our Proofpoint tenant routing — Graph or an internal relay is the activation, see docs/EMAIL.md)
- Live updates via SSE (the UI polls today — adequate at our scale)
- Per-ticket confidential access (today: role RBAC plus per-queue visibility are enforced server-side — agents can be restricted to their own queues; ticket-level restrictions for HR/legal still needed)

**Known engineering debt (deliberate for a one-week build)**
- Background work runs on in-process timers; production needs durable jobs with retries and idempotency (pg-boss is already a dependency, unused)
- No optimistic-concurrency control on ticket edits (last write wins)
- Schema managed by push, not versioned migrations
- One automated test (SLA business-time math); everything else was verified end-to-end in the browser per feature, but a real suite is table stakes for pilot
- Dev conveniences to remove: permissive CORS, no rate limits, limit-based (not cursor) pagination

## Requirements coverage

| Requirement | Status |
|---|---|
| Create/edit/assign/track/close, standard fields | ✅ Live |
| Configurable queues + automated routing | ✅ Live — rules engine + AI routing + expertise/round-robin assign |
| Response & resolution SLAs with breach alerts | ✅ Live |
| Email-based creation & two-way communication | 🟡 Pipeline live end-to-end; SMTP outbound built with delivery audit; Graph inbound designed, not built |
| Searchable KB / self-service | ✅ Live — hybrid full-text + semantic search, AI-drafted articles |
| Incident / request / change workflows | ✅ Live — one number space, type-driven; manager approvals live |
| Reporting & dashboards | ✅ Live |
| Roles, permissions, access levels | ✅ Role matrix (admin/agent/requester/readonly) + per-queue leads + queue visibility, enforced server-side; per-ticket confidentiality planned |
| ServiceNow migration | 🟡 CSV import built — auto-mapping, idempotent re-runs, legacy INC numbers searchable; dry run against a full real export still pending |
| ≥1 AI-assisted workflow | ✅ Nine distinct AI workflows, all audited |
| Reduce software & admin cost | ✅ See TCO scenarios — 65–90% depending on assumptions |
| Easy configuration changes | ✅ Live, demonstrated |

## AI governance (what leaves the building, and the controls)

Ticket subject/description, requester name/department, matched directory
candidates, and recent corrected ticket subjects are sent to the Anthropic
API for triage. Controls that exist today: per-field confidence gates,
full audit of every AI action with one-click revert, human review before
KB drafts publish, per-feature token logging with a daily budget cutoff,
and a global kill switch (`AI_PROVIDER=mock` degrades every AI feature to
keyword heuristics, live-tested). Pilot commitments before real data: a
redaction pass and sensitive-queue exclusion list, prompt-injection review
(ticket text is untrusted input), a confirm-instead-of-auto mode for
requester-changing actions (the human-correction flow for this already
exists), and expiry on old corrections.

## Three-year cost scenarios (honest TCO, not license math)

Assumes a loaded internal FTE ≈ $140k/yr. All figures rounded.

| Scenario | Assumptions | 3-yr total |
|---|---|---|
| **Stay on ServiceNow** | $300k/yr + escalators, continued admin dev | **~$950k+** |
| **Commercial mid-market** (Halo/Freshservice tier) | ~$40k/yr licenses + migration/config one-time + admin time | **~$200k** |
| **METS — best case** | $8k/yr infra+AI, 0.1 FTE steady-state after hardening | **~$90k** |
| **METS — expected** | $10k/yr infra+AI, 0.25 FTE ownership, one-time hardening + security review + migration dev (~$50k) | **~$185k** |
| **METS — high-support** | 0.5 FTE, pen test + compliance work, extended parallel run | **~$320k** |

Even the high-support case saves ~65% versus ServiceNow over three years —
and unlike the commercial alternative, the roadmap is ours. The v1.0
"97% cheaper" figure compared software licenses only; these scenarios
include the cost of owning a bespoke platform (engineering time, security
review, on-call, parallel operation).

## Pilot path

1. **Gap assessment → hardening sprint (3–4 weeks):** durable jobs,
   concurrency control, versioned migrations, test suite over RBAC /
   internal-note confidentiality / SLA transitions / approvals, rate
   limits + CORS + pagination, attachment malware scanning + short-lived URLs
2. **Activation:** Entra app registration (SSO is one config swap), Graph
   mail transport on the shared helpdesk mailbox
3. **Migration dry run** against a real ServiceNow export, reconciliation
   report reviewed before any cutover
4. **One-team pilot** alongside ServiceNow for one month — IT queues first
   (no confidential-queue requirement), success criteria agreed up front
5. Phased cutover; ServiceNow read-only archive for history

## The ask

Approve the gap assessment and one-team pilot. Even the conservative path —
hardening sprint, security review, and a full parallel year — costs a
fraction of one ServiceNow renewal, and every week of the pilot the tool
gets smarter on our own tickets.
