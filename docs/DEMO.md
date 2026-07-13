# METS Demo Script (~10 minutes)

## Prep (morning of — 15 minutes)

1. Start Docker Desktop, then from the repo root:
   ```sh
   npm run db:seed     # fresh data: near-breach SLA tickets are staged
                       # relative to seed time — reseed the morning of
   npm run dev         # API :3001 + site at http://mets.masterelectronics.com
   ```
2. Open the site, pick a theme (dark pops on a projector), acting user =
   **Justin Rhoda** (admin).
3. AI Triage tab → **Run AI Triage (10 tickets)** once, so suggestion cards
   are waiting. Accept none.
4. Verify `.env` has `AI_PROVIDER=claude` and the key. If conference wifi
   dies mid-demo, set `AI_PROVIDER=mock` and restart — every AI feature
   keeps working with the keyword fallback.
5. Have `docs/PROPOSAL.md` open in a tab for the close.

## The demo

**1. Open on the queue (60s).**
"This is METS — one web app, one Postgres database, ~$8k a year all-in."
Point out: score-sorted queue, priority rails on the row edge, the SLA
depletion meters (some already red — data is honest), queue + category on
every row, site tags like `phoenix`/`germantown` instead of 10 per-site
queues. Hover a truncated subject. Flip dark/light.

**2. The pain points, live (90s).**
- Drag a ticket onto your own card → assigned, status flips to Open.
- Drag another onto MERP in the right rail → re-queued in one gesture.
- Select-all checkbox → bulk bar → Auto-assign → load-capped round robin
  distributes them (watch the agent load bars move).
- Drag one to the **Holding area** → snooze with a reason. "Hidden, but
  leads see all snoozed tickets and the SLA clock keeps running — hiding a
  ticket can't defuse it."

**3. AI Triage (2 min).**
Open the AI Triage tab (cards pre-run). Walk one card: current → suggested
category/queue/priority with per-field confidence, sentiment flag, the
agent-ready summary. Find one with a **priority correction** (P1 → P2:
"requesters over- and under-state priority; the AI judges business impact").
Accept one card, then **Accept all high-confidence**. "Below the gate,
nothing is touched — corrections train the thresholds."

**4. Create a ticket live (90s).**
+ New Ticket. No category picker, no queue picker — type a vague-but-real
description ("The label printer at pack station 2 is printing everything
half an inch off, truck leaves at 3"). Create, sort queue by date, expand
it: routing + SLA already attached; within seconds the AI panel and
`ai`-actor events appear in the activity trail. "Auditable and revertible —
never a silent change."

**5. Email round-trip (90s).**
Email tab. Compose from any address (make one up — it becomes a guest
contact). Send → auto-ack with the ticket number appears in the inbox.
Switch to Queue, find it (source: email), **✨ Draft reply** — Claude drafts
from the knowledge base with a citation — edit a word, Send. Back to
Email: the reply is in the requester's inbox. Reply keeping `[T-…]` in the
subject → appended to the same ticket. "The Graph adapter swaps in for
production; the pipeline you just watched doesn't change."

**6. SLA + dashboards (60s).**
Point at a near-breach meter draining. "A sweep runs every minute —
warnings fire once, breaches raise the score so the ticket climbs the
queue, all in the audit trail. Business-hours math, DST-safe, pause on
pending statuses." Dashboards tab: median (not mean) MTTR, SLA attainment,
backlog age, and the TP leaderboard — "not all tickets are created equal."

**7. Knowledge base (45s).**
KB tab. Search by *meaning*: type "wifi drops when I move around the
warehouse" → RF scanner guide surfaces without sharing keywords. "Hybrid
search: full-text plus local embeddings — no extra services, still one
Postgres."

**8. Admin — the no-code close (90s).**
Admin tab. Change the P4 weight → Save → "152 open tickets rescored" →
Queue tab: order visibly changed. Add a routing rule in the form
("payroll" → People Operations), create a matching ticket, expand it: the
rule fired, logged in the trail. Add a status ("Waiting on Parts",
category pending) — "pauses SLA clocks with zero engine changes. This is
what killing the ServiceNow admin tax looks like."

**9. Close (30s).**
Proposal one-pager: $300k → ~$8k/yr, requirements coverage, the 52→17
queue consolidation, and the production path (Entra SSO, Graph mail,
ServiceNow migration) already designed behind config-swap adapters.

## Recovery notes

- AI call fails live → the ticket still works (AI is off the request
  path); re-run triage, or flip `AI_PROVIDER=mock` and restart.
- Port 80 taken → Vite prints the fallback port; use that.
- Anything weird with data → `npm run db:seed` resets in ~10 seconds.
