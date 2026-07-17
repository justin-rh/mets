# METS — Master Electronics Ticketing System

A ServiceNow replacement built in one week: simpler, faster ticketing for
internal teams, with an AI triage engine (**SOTO**) that routes,
prioritizes, and summarizes every ticket so nobody ever picks a category.

- [`docs/DESIGN.md`](docs/DESIGN.md) — full design, architecture, phased plan
- [`docs/PROPOSAL.md`](docs/PROPOSAL.md) — competition one-pager (cost, coverage)
- [`docs/EMAIL.md`](docs/EMAIL.md) / [`docs/SSO.md`](docs/SSO.md) — production integration notes
- [`docs/research/`](docs/research) — market landscape and engineering research

## Stack

React + Vite (web) · Fastify + TypeScript (server) · PostgreSQL 16 with
pgvector + pg_trgm (everything: OLTP, search, vectors, jobs) · Claude API
(all AI features, with a keyword-mock fallback so the app runs keyless).

## Installation

Prereqs: **Node 20+**, **Docker Desktop** (for Postgres), and an
Anthropic API key for the AI features (optional — without one, set
`AI_PROVIDER=mock` and everything still works with keyword heuristics).

```sh
git clone <repo> && cd mets
cp .env.example .env        # fill in ANTHROPIC_API_KEY
npm install
npm run db:up               # Postgres 16 + pgvector via Docker (port 5433)
npm run db:push             # create extensions + schema
npm run db:seed             # demo world: agents, queues, ~800 tickets, KB, AI history
npm run dev                 # API on :3001, web on :80
```

Open `http://localhost/`. The web dev server binds all interfaces on
port 80 (so LAN viewers can browse to the machine's IP); the API and
Postgres stay loopback-only, with the web proxying `/api`. On Linux/macOS,
port 80 may need privileges — change `port` in `web/vite.config.ts` if so.

Auth is the dev adapter by default: the user switcher in the top bar acts
as any seeded user (Entra SSO is built and dormant — see `docs/SSO.md`).

**Demo tooling** (Windows PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1   # boot everything (self-bootstraps a fresh machine), print URLs
powershell -ExecutionPolicy Bypass -File scripts\reset-demo.ps1   # reseed to baseline (~2 min)
python scripts\demo-tickets.py                                    # stage the scripted demo tickets
```

## Features worth highlighting

### SOTO — the AI layer
- **Zero-field intake** — requesters describe the problem; SOTO picks the
  category, queue, and priority with per-field confidence, writes the
  subject if it's blank or vague, and explains its reasoning. Vision
  included: a ticket that's just a pasted screenshot gets routed from
  what's *in the image*.
- **It learns** — dragging a ticket to a different queue (or correcting it
  right on the post-submit screen) records a training example that feeds
  future routing. An org glossary teaches it company vocabulary (ZScaler,
  MERP/OMS, Proofpoint).
- **Zero-agent resolutions** — at intake, SOTO searches the knowledge base
  and, when a published article genuinely solves it, walks the requester
  through the fix; a "that solved it" reply closes the ticket untouched.
- **Suspected-incident detection** — three similar reports in a short
  window become a P1 parent with an AI-written responder summary and an
  app-wide banner. One reply broadcasts to every linked requester; one
  resolve cascades everything closed. (Try the **⚠️ Incident Demo** button
  on the mode bar.)
- **Guided intake flows** — Databricks access requests get SOTO's
  clarifying questions, parsed answers, and routing to the right team with
  a structured handoff table.
- **Bilingual tickets** — a ticket filed in Spanish is translated for the
  agent; the agent's English reply goes back with a Spanish translation.
- **Self-auditing** — a dashboard scoreboard tracks routing accuracy
  against human judgment, cost per call by feature, and total AI spend
  (~$11/month all-in at demo volume, ~2¢ per triage). A weekly SOTO
  briefing reports recurring problems, trends, and KB gaps.

### The board
- Drag-and-drop everything: onto an agent to assign, onto a queue to
  move, onto the holding area to snooze until a calendar date.
- Scoring engine with admin-tunable weights — priority, age, VIP, SLA
  state, flag keywords, AI-read sentiment (😤/⚡ boost, ALL-CAPS penalty).
- Business-hours SLA engine with warn/breach meters on every row;
  expertise-based auto-assign with fit scores; out-of-office handling;
  natural-language search ("open printer tickets in phoenix older than a
  week").

### Knowledge base
- Hybrid search (keywords + embeddings), searchable from inside any
  ticket. SOTO drafts articles from resolved threads — automatically when
  it spots a reusable fix, or on demand via the ticket's **Draft KB
  article** button — and agents review, edit, and publish from the KB tab.

### Operations & integration
- **ServiceNow CSV import** — auto-mapped preview, idempotent runs, legacy
  INC numbers stay searchable. 52 ServiceNow queues consolidated into 17.
- **Public REST API** — admin-minted keys acting as bound users under full
  RBAC; OpenAPI docs at `/api/docs`.
- **Recurring tickets** — scheduled maintenance files itself through the
  normal pipeline (with a Run-now button for demos).
- **Email pipeline** — inbound simulator, reply-token threading,
  reopen-on-reply, SMTP outbound adapter with delivery audit.
- RBAC (admin / agent / requester / readonly, per-queue leads, queue
  visibility), requester self-service portal with CSAT, manager approvals
  wired to the org chart, VIP lists (global and per-queue), full audit
  trail on every change.

## Layout

```
server/   Fastify API, Drizzle schema, AI provider + enrichment pipeline,
          jobs (SLA sweep, escalation, recurring, digest, auto-close)
web/      React SPA — queue board, dashboards, KB, email simulator, admin
scripts/  demo tooling (start/reset, staged demo tickets, incident demo)
docs/     design doc, proposal, demo scripts, research appendices
```
