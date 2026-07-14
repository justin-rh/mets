# METS Demo Script (~12 minutes)

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
5. Keep a terminal open at `server/` for the outage burst
   (`npm run demo:traffic -- outage`) — it's the showstopper.
6. Have `docs/PROPOSAL.md` open in a tab for the close.

## The demo

**1. Open on the queue (60s).**
"This is METS — one web app, one Postgres database, ~$8k a year all-in."
Point out: score-sorted queue, priority rails on the row edge, SLA
depletion meters (some already red — data is honest), queue + category on
every row, 🚩 flag keywords riding high (hover one: "urgent +15" — admins
pick the keywords), the `*` on a requester name (hover: filed on their
behalf), site tags like `phoenix-az` instead of 10 per-site queues. The
chat bubble bottom-right already has unread messages — come back to it.
Flip dark/light.

**2. The pain points, live (90s).**
- Drag a ticket onto your own card → assigned, status flips to Open.
- Drag one onto **James Lee (OOO badge)** → blocked with a toast: "out of
  office — not assigned." Auto-assign skips him too. Click his card →
  anyone can mark themselves out.
- Drag another onto MERP in the right rail → re-queued in one gesture.
- Select-all → bulk bar → **Auto-assign (Expertise)** → skills earned from
  resolution history + location matching pick the assignees (watch the
  load bars). Undo is right there in the toast.
- Drag one to the **Holding area** → snooze with a reason. "Leads still
  see snoozed tickets and the SLA clock keeps running."

**3. AI Triage + the learning loop (2 min).**
AI Triage tab (cards pre-run). Walk one card: per-field confidence,
sentiment, agent-ready summary; find a **priority correction** ("requesters
over- and under-state priority; the AI judges business impact"). Accept
one, then **Accept all high-confidence**. Decision log below: every
routing decision, confidence, agreement rate. **Flag & correct** one →
create a similar ticket → the AI follows the correction on the very next
classification. "Agents teach it in one click."

**4. Create a ticket live — and the approval gate (90s).**
+ New Ticket. No category picker — AI routes it. First a normal incident:
watch the post-submit screen resolve to Queue / Category / Priority with
confidence. Then a **request**: "Need a second monitor for my desk" → the
screen shows "**Hardware requests need a manager sign-off** — sent to
[manager] for approval." Open it: parked at intake, Awaiting Approval,
SLA paused, SOTO Bot told the requester. Approve it from the banner →
routed on, requester notified. "SOTO Bot — Sorts Out Tickets, Obviously."

**5. THE OUTAGE (2 min — the showstopper).**
Terminal: `npm run demo:traffic -- outage` — four "Zoom is down" tickets
from four requesters hit the live pipeline. Queue tab, sort by newest:
on the third report the AI recognizes one root cause and **declares a P1
major incident** — parent ticket, AI-written responder summary, children
linked, every requester told "you're not alone" automatically. The fourth
report gets absorbed into the open incident. Open the parent, type one
update ("bad firewall rule, rolling back, 15 minutes") → **broadcast to
every linked requester**, first-response SLAs completed. "Four tickets,
one incident, one update. ServiceNow can't do this without a consultant."

**6. Email round-trip (60s).**
Email tab. Compose from a made-up address → guest contact, SOTO Bot
auto-ack with the ticket number lands in the inbox. Queue → find it →
**✨ Draft reply** (Claude, KB-grounded, cited) or **📋 Template** (canned
responses with variables filled in). Send; reply with `[T-…]` in the
subject → appended, reopened if needed.

**7. The requester side — RBAC live (60s).**
User switcher → any **Requester**. The whole app becomes the Support
Portal: their tickets only, status in plain language, the conversation,
reply-to-reopen, and **CSAT stars on anything resolved** — rate one.
Internal notes, other people's tickets, agent tools: all 403 server-side,
not just hidden. Switch back — agent board returns.

**8. Chat + SLA + dashboards (75s).**
Chat bubble: unread thread from an agent — the ticket number in the
message is a **live link**. Reply. "Discuss tickets without leaving the
tool — and without pasting screenshots into Slack." Then dashboards:
median MTTR, SLA attainment, **CSAT average + distribution** (closing the
loop the requester just fed), backlog age, TP leaderboard — "not all
tickets are created equal."

**9. Knowledge base (30s).**
Search by meaning: "wifi drops when I move around the warehouse" → RF
scanner guide surfaces without shared keywords. "Full-text + local
embeddings, still one Postgres."

**10. Admin — the no-code close (90s).**
Admin tab, rapid-fire: change the P4 weight → "152 open tickets rescored"
→ queue order visibly changed. Add a **flag keyword** ("printer" +25) →
instant rescore, flags appear. Toggle an **approval gate** on a category.
Add a routing rule, add a status, tune SLA policies + **auto-close days**,
edit **response templates** (auto-respond = SOTO Bot), grant an agent a
skill. "Every knob an admin turns in ServiceNow with a consultant and a
change window — here it's a click, audited, instant."

**11. Close (30s).**
Proposal one-pager: $300k → ~$8k/yr, requirements coverage (queue, AI,
SLA, KB, dashboards, email, RBAC, approvals — all live, not slides), the
52→17 queue consolidation, production path (Entra SSO, Graph mail,
migration) designed behind config-swap adapters.

## If judges ask "what's next" (built-out backlog, specs written)

- **KB articles from resolutions** — AI drafts an article when a reusable
  fix resolves; the system gets smarter with every ticket.
- **Escalation rules** — unassigned P1 > 30 min pings the queue lead (bell
  + SOTO chat message).
- **Sentiment escalation** — triage already captures it; frustrated
  requesters get a score bump.
- **Ticket watchers**, **merge duplicates**, **recurring tickets**
  (preventive maintenance), **natural-language queue search**.
- **Entra SSO** — the auth adapter is built for it; one app registration
  away.

## Recovery notes

- AI call fails live → the ticket still works (AI is off the request
  path); re-run triage, or flip `AI_PROVIDER=mock` and restart.
- The outage burst declares nothing? It needs 3 similar same-category
  tickets within 2h — rerun it; a second run absorbs into the first
  incident, which is its own demo beat.
- Port 80 taken → Vite prints the fallback port; use that.
- Anything weird with data → `npm run db:seed` resets in ~10 seconds.
