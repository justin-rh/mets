# METS — Master Electronics Ticketing System

ServiceNow replacement: simpler, AI-assisted ticketing for internal teams.

- [`docs/DESIGN.md`](docs/DESIGN.md) — full design, architecture, phased plan
- [`docs/PROPOSAL.md`](docs/PROPOSAL.md) — competition one-pager (cost, coverage)
- [`docs/DEMO.md`](docs/DEMO.md) — 10-minute demo script + prep checklist
- [`docs/research/`](docs/research) — market landscape and engineering research

## Stack

React + Vite (web) · Fastify + TypeScript (server) · PostgreSQL 16 with
pgvector + pg_trgm (everything: OLTP, search, vectors, jobs) · Claude API (AI).

## Quick start

```sh
cp .env.example .env        # fill in ANTHROPIC_API_KEY for AI features
npm install
npm run db:up               # Postgres via Docker (port 5433)
npm run db:push             # create extensions + schema
npm run db:seed             # demo data (agents, queues, tickets, KB)
npm run dev                 # server :3001 + web :5173
```

## Layout

```
server/   Fastify API, Drizzle schema, jobs (SLA sweep, AI enrichment)
web/      React SPA — queue board, dashboards, KB, admin
docs/     design doc + research appendices
```
