# METS Demo Video — 3-minute shot list

Recorded, not live: every AI beat is guaranteed to land and dead air gets
cut. Record segments separately; stitch in order.

## Recording prep

1. `powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1`, then
   `scripts\reset-demo.ps1` (~2 min), then `python scripts\demo-tickets.py`
   (add `--screenshot your.png` to use your own image) — stages the five
   demo tickets and prints the cheat sheet of ticket numbers.
2. Browser 1920×1080, dark mode, acting user = Justin Rhoda. Leave the
   welcome card visible for the opening frame; dismiss it for later
   segments.
3. `.env`: `AI_PROVIDER=claude` + key (start-demo warns if not). Cut AI
   wait time in editing but leave a beat of spinner — it reads as live.
4. Voiceover after picture lock. Script business outcomes, not UI
   mechanics.

---

## SEGMENT 1 — Welcome to METS (0:00–0:10)

**Shots:** the queue board with the welcome card visible. Hold one beat,
then a slow pan starting down the scored, SLA-timed queue.

**VO:** "This is METS — the Master Electronics Ticketing System. Built in
one week by Claude Code and me."

## SEGMENT 2 — Intro (0:10–0:35)

**Shots:**
1. Quick pan — score column, SLA meters, priority rails.
2. **Drag a ticket onto an agent** in the left rail → status flips to
   In Progress, assignee chip appears.
3. **Drag another to a different queue** → it re-files instantly.
4. **Drag one to the Holding Area** → the calendar pops → click a date,
   type a reason → gone until that morning.

**VO:** "ServiceNow costs us about $300,000 a year. This is our queue — scored, SLA-timed, and everything is drag and drop: drop a
ticket on an agent to assign it, drop it on a queue to move it, drop it
on the holding area and pick the day it comes back. Any mistakes can be undone with one click. But the board isn't
why I built this — every ticket here was routed, prioritized, and
summarized by SOTO, the AI triage engine built into it. Nobody has to
pick a category. Watch."

## SEGMENT 3 — Image-based categorization (0:35–1:05)

**Shots:**
1. **+ New Ticket.** Leave the subject blank. Description: "Keeps
   happening, screenshot attached." **Paste the error screenshot**
   (Ctrl+V). Create.
2. The routing screen resolves on camera: **AI-written subject**, queue,
   priority, and the ✨ summary **quoting the error code and server name
   straight off the image** — text that appears nowhere in the ticket.
3. One beat on the **"Wrong queue? Move it"** dropdown — flick it to
   another queue → "✓ Moved — SOTO learns from this correction."

**VO:** "No subject, no category picker — one sentence and a pasted
screenshot. SOTO read the image, wrote the subject, routed it to the
right team, and set priority from the described impact. And if it ever
gets one wrong, the fix is one click and drag — and it learns from the
correction."

## SEGMENT 4 — TMP drive (1:05–1:30)

**Shots:**
1. Expand the staged **"Can't get into the TMP drive"** ticket.
2. Hit **📚 Search KB** — the TMP/M: drive registry-fix article is the
   top hit; expand it inline, scroll a beat on the numbered steps.
3. Flash the **📝 Draft KB article** button beside it.

**VO:** "The knowledge base is wired into the ticket itself. One click
and the fix is on screen — this is a real issue with a real fix for our service desk built into the ticket itself. And the knowledge base writes itself: when an agent resolves
something reusable, SOTO can draft the article automatically from the ticket thread."

## SEGMENT 5 — Spanish ticket (1:30–1:55)

**Shots:**
1. Expand the staged Spanish printer ticket — the 🌐 **"TRANSLATED FROM
   SPANISH"** block sits above the original text.
2. Type a short reply in English → send.
3. Cut to the requester portal: the reply arrives **with the Spanish
   translation appended**.

**VO:** "A warehouse associate submits a ticket in Spanish. The agent reads it in
English, answers in English — and the requester gets it back in Spanish.
Nobody translates anything; the language barrier just isn't there."

## SEGMENT 6 — Dashboards & cost (1:55–2:25)

**Shots:** Dashboards tab. Hold on the **impact headline** ("Last 30
days: N tickets routed hands-free · total AI spend $X"), then the **AI
routing accuracy** tile, the **per-feature cost-per-call** table, and a
beat on the **weekly briefing** card.

**VO:** "And it audits itself. Routing accuracy measured against human
judgment. Every AI call metered — about two or three cents a ticket. Once a week SOTO reads the whole
queue and reports the recurring problems worth root-causing, including
the ones with no knowledge-base article yet."

## SEGMENT 7 — Admin & API (2:25–3:00)

**Shots (~7s each):**
1. Admin → **Scoring**: add keyword `autostore` with a boost → rescore →
   the staged AutoStore ticket's score jumps on the board.
2. Admin → **Users & Queues**: roles, per-queue leads, queue visibility.
3. Admin → **AI & Automation**: Recurring tickets card — hit **▶** on the
   Zebra printer PM → "filed T-… ✓".
4. **`/api/docs`** — the OpenAPI page, one scroll.

**VO:** "Every knob ServiceNow charges for is a click here —
scoring weights, roles and queue access, scheduled maintenance that files
its own tickets. And it's open: a keyed REST API with docs, so anything
we run can create and work tickets. One week, one web app, one database —
and an AI teammate, for pennies a ticket. This is METS."

---

## Cut from the video (exists — for Q&A)

**One-button extras:** ⚠️ Incident Demo on the mode bar (3 similar
reports → amber suspected-incident banner → broadcast → resolve cascade);
`python scripts\demo-tickets.py email mention databricks` stages the
inbound-email ticket, the mentioned-agent gold-ring assign, and the
Databricks guided intake.

**Everything else:** KB deflection (zero-agent resolutions), ServiceNow
CSV import with legacy numbers, natural-language queue search, manager
approvals, VIP scoring, snooze calendar, merge with part-number guard,
agent chat, watchers, OOO handling, RBAC enforcement, Markdown
everywhere, paste-to-attach renaming, escalation sweep, TP leaderboard,
CSAT analytics, templates, auto-close, away-site tag highlighting,
notifications.

## Retake / sanity notes

- Data weird → `reset-demo.ps1` (~2 min) then rerun `demo-tickets.py`.
  Ticket numbers change every restage — reshoot a segment end-to-end
  rather than splicing takes across reseeds.
- Segment 3 works with any pasted error screenshot; the staged
  screenshot ticket is the fallback if a live take misbehaves. Routing
  follows the image content (an OMS error → MERP; a Keeper error →
  Security & Access) — glance before narrating.
- Segment 5: the portal shot needs the acting user switched to the
  Spanish ticket's requester (cheat sheet names them).
- Segment 7: add the keyword, then use Run rescore so the jump is
  on-camera; reseed afterward restores baseline weights.
- AI latency: cut it, keep a spinner beat. Event timestamps corroborate
  that it's live.
