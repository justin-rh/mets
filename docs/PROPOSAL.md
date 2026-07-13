# METS — Proposal One-Pager

**Problem #4: Ticketing System Replacement · Team Rhoda**

## The problem

We pay **~$300,000/year** for ServiceNow and use it for basic ticket
management. Enhancements need specialist development; agents fight the tool
(self-assignment, re-queuing, mis-set priorities, RITM/REQ noise).

## The solution

**METS** — a purpose-built ticketing system: one web app, one PostgreSQL
database, one job runner. Postgres alone handles transactions, full-text
search, vector search, reporting, and scheduled jobs at our scale
(~36k tickets/yr). AI (Claude API) does the triage humans hate.

| | ServiceNow today | METS |
|---|---|---|
| Annual software cost | ~$300,000 + escalators | **~$5–8k** (Azure infra + AI) |
| Admin burden | Specialist dev for changes | Admin UI: weights, SLAs, statuses, rules |
| AI | Paid add-ons | Built in, ~$50–100/mo at full volume |
| Queues | 52 (per-site sprawl) | **17** + site/function tags |
| Best commercial alternative | — | $24–60k/yr (HaloITSM / ManageEngine / Freshservice), generic UX |

## Requirements coverage

| Requirement | Status |
|---|---|
| Create/edit/assign/track/close with standard fields | ✅ Built — drag-and-drop queue, bulk actions, full audit trail |
| Configurable queues + automated routing | ✅ Built — rules engine (first-match, logged), round-robin/load-based auto-assign |
| Response & resolution SLAs with breach alerts | ✅ Built — business-hours engine, pause on pending, 60s sweep, breach events + score escalation |
| Email-based creation & two-way communication | ✅ Built (mock transport) — full pipeline live: threading, guest contacts, auto-ack, reopen-on-reply; Microsoft Graph adapter is a config swap (production design documented) |
| Searchable knowledge base / self-service | ✅ Built — hybrid search (full-text + local embeddings), suggested articles on tickets |
| Incident / service request / change workflows | ✅ One number space, `type` drives workflow; change approvals designed (single-approver v1) |
| Reporting & dashboards | ✅ Built — volume, median MTTR/FRT, SLA attainment, backlog age, team TP leaderboard |
| Roles, permissions, queues, access levels | ✅ RBAC (admin/agent/requester) enforced server-side; team-based queue access; Entra SSO designed behind the dev-auth adapter |
| ServiceNow migration | 📋 Designed & de-risked — REST Table API export incl. journal comments/attachments, field-mapping validation, open + 24mo full fidelity, older read-only archive (docs/research) |
| ≥1 AI-assisted workflow | ✅ Four — categorization/routing with confidence gates, priority correction, summarization, KB-grounded suggested replies |
| Reduce software & admin cost | ✅ ~97% software cost reduction; admin work becomes form edits |
| Easy configuration changes | ✅ Demonstrated live — score weights, SLA targets, statuses, routing rules from the Admin UI |

## What the prototype proves

Everything above marked ✅ runs today against 800 realistic seeded tickets —
live Claude triage at 0.9+ confidence on clear tickets, honest deferral to
humans on ambiguous ones, an SLA breach visibly re-ranking the queue, and an
email→ticket→AI→reply round-trip in under a minute.

## Production path (already designed, adapter-swap each)

1. **Entra ID SSO** (OIDC/MSAL) + user sync via Graph delta queries
2. **Microsoft Graph mail** on the shared helpdesk mailbox (RBAC-scoped app
   permissions, webhook + poll, Message-ID threading)
3. **ServiceNow migration** with dry-run validation, then 1-month parallel run
4. Azure App Service + Azure Database for PostgreSQL; nightly backups

## The ask

Pilot METS with one team's queue alongside ServiceNow for one month, then
phase the cutover. Even a conservative path (run both for a full year)
costs less than 3% of the ServiceNow renewal.
