# METS Demo Video — 3-minute shot list

Recorded, not live: every AI beat is guaranteed to land and dead air gets
cut. Record segments separately; stitch in order.

**Paced to the rubric** — Business Impact 40% / Technical Execution 30% /
Usability & Clarity 30%. Impact owns the open, the zero-agent segment, the
dashboard, and the close (~70s). Execution and usability ride every live
beat in between.

## Recording prep

1. `powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1`, then
   `scripts\reset-demo.ps1` (~2 min), then `python scripts\demo-tickets.py`
   — stages the Spanish ticket, TMP ticket, and friends, and prints the
   cheat sheet of ticket numbers.
2. Browser 1920×1080, dark mode, acting user = Justin Rhoda. Decide on the
   welcome card: leave it for the opening frame (it states the product in
   one sentence), dismiss it for every later segment.
3. **Incident b-roll first** (it brews 1–6 min): press **⚠️ Incident
   Demo** on the mode bar, wait for the amber banner, capture 10s —
   banner, parent ticket (note SOTO's handling note), one broadcast
   toast, then resolve it for the cascade. Reseed + restage afterward.
4. `.env`: `AI_PROVIDER=claude` + key (start-demo warns if not). Cut AI
   wait time in editing but leave a beat of spinner — it reads as live.
5. Voiceover after picture lock. Script business outcomes, not UI
   mechanics.

---

## SEGMENT 1 — The problem (0:00–0:18) · *impact*

**Shots:** queue board, welcome card visible, slow pan down the scored,
SLA-timed queue.

**VO:** "Enterprise ticketing costs us about $300,000 a year, and nobody
picks the right category anyway. This is METS — built in one week. Every
ticket you're looking at was routed, prioritized, and summarized by SOTO,
the AI triage engine inside it."

## SEGMENT 2 — Intake with zero fields (0:18–0:55) · *usability + execution*

**Shots:**
1. **+ New Ticket.** Leave the subject blank. Description: "Keeps
   happening, screenshot attached." **Paste the OMS error screenshot**
   (Ctrl+V). Create.
2. Routing screen resolves on camera: **AI-written subject**, Queue
   **MERP**, priority, the ✨ summary **quoting the error code and server
   name from the image** — text that appears nowhere in the ticket.
3. Point at the **"Wrong queue? Move it"** dropdown — flick it to another
   queue → "✓ Moved — SOTO learns from this correction." *(One take: this
   is the training loop and the safety valve in a single frame.)*

**VO:** "No category picker, no queue picker — no subject, even. I pasted a
screenshot and typed one sentence. SOTO read the image, wrote the subject,
routed it, and set priority — and if it ever gets one wrong, the fix is one
click, and it learns from the correction."

## SEGMENT 3 — Tickets that cost zero agent minutes (0:55–1:25) · *impact*

**Shots:**
1. Switch acting user to a requester → Support Portal. File: "I moved
   desks this week — how do I set up the printer closest to my new desk?"
2. SOTO replies in-thread with numbered steps from the printer-mapping
   KB article (offer lands ~20–40s after filing; cut the wait).
3. Requester answers "That solved it, thank you!" → ticket resolves
   itself → rate ★★★★★.

**VO:** "Watch what didn't happen: no agent. SOTO matched the ticket to a
knowledge-base article, walked the user through the fix, and closed the
loop when they confirmed. Every one of these is a ticket the team never
touches — and the knowledge base writes itself: when an agent resolves
something reusable, SOTO drafts the article."

## SEGMENT 4 — When things break at scale (1:25–1:45) · *execution*

**Shots:** the pre-recorded incident b-roll — three similar tickets hit,
amber **SUSPECTED INCIDENT** banner appears app-wide, one update broadcasts
to every linked ticket, resolving the parent cascades and clears the banner.

**VO:** "Three people report the same failure within minutes — SOTO
declares a suspected incident, banners the whole company so duplicates
stop, and one resolution closes every linked ticket and tells every
requester."

## SEGMENT 5 — The receipts (1:45–2:15) · *impact*

**Shots:** Dashboards tab. Hold on the **impact headline** ("Last 30 days:
N tickets routed hands-free · total AI spend $X"), then the **AI routing
accuracy** tile, the per-feature **cost-per-call** table, and the **weekly
briefing** card (SOTO's detected recurring problem).

**VO:** "It audits itself. Routing accuracy against human judgment, every
AI call metered — a month of triage costs less than ten dollars. And once a
week SOTO reads the whole queue and reports the problems worth
root-causing, including the ones with no KB article."

## SEGMENT 6 — Getting here is a CSV (2:15–2:40) · *impact + execution*

**Shots:**
1. Admin → Import: upload the ServiceNow CSV → mapped automatically →
   15 tickets in, legacy INC numbers searchable.
2. Rapid cuts (~4s each): the Spanish ticket's 🌐 translated block +
   English reply; `/api/docs` Swagger page; the Recurring tickets card.

**VO:** "Migration is a CSV upload — legacy ticket numbers still resolve.
Spanish tickets are translated both directions automatically. There's a
keyed public API, and scheduled maintenance files its own tickets."

## SEGMENT 7 — Close (2:40–3:00) · *impact*

**Shots:** back to the board, one ticket expanding to show the AI panel's
reasoning line.

**VO:** "One week, one web app, one database — running our real workflows
with an AI teammate that routes, deflects, documents, and reports, for
pennies a ticket. Next: single sign-on is one app registration away,
Graph mail is an adapter swap, and the training loop keeps compounding.
This is METS."

---

## Rubric coverage check

- **Business Impact (40%)** — segments 1, 3, 5, 6, 7: the cost problem,
  zero-agent resolutions, metered AI economics, painless migration.
- **Technical Execution (30%)** — live end-to-end intake with vision
  (seg 2), incident correlation + cascade (seg 4), import idempotence,
  API docs (seg 6).
- **Usability & Clarity (30%)** — zero-field intake, one-click correction
  (seg 2), requester self-service (seg 3), self-explaining dashboard
  (seg 5), welcome card in the opening frame.

## Cut from the video (exists — one VO line covers it in Q&A)

Mentioned-agent auto-assign, snooze calendar, natural-language queue
search, manager approvals, VIP scoring, merge with part-number guard,
agent chat, watchers, OOO handling, RBAC + queue visibility, KB manual
authoring/editing, ticket→KB button, Markdown everywhere, paste-to-attach
renaming, escalation sweep, TP leaderboard, CSAT analytics, templates,
auto-close, recurring Run-now, away-site tag highlighting, email
notifications, notification bell.

## Retake / sanity notes

- Data weird → `reset-demo.ps1` (~2 min, embeddings rebuild) then rerun
  `demo-tickets.py`. Ticket numbers change every restage — reshoot a
  segment end-to-end rather than splicing takes across reseeds.
- Segment 2 works with any pasted error screenshot; the staged
  T-…801 ticket is the fallback if the live take misbehaves
  (`demo-tickets.py --screenshot your.png` to use your own image).
- Segment 3: file as a **requester** in the portal — deflection only
  offers on requester-filed tickets, and only for self-serve fixes (the
  TMP registry article is deliberately NOT deflectable: admin rights).
  The printer-mapping question is verified to deflect. Reply wording
  must contain "solved" / "fixed" to auto-resolve.
- Incident b-roll: 3 similar tickets in 20 min triggers it; declaration
  takes 1–6 min after the third. `incident-demo.py` does the filing.
- AI latency: cut it, keep a spinner beat. Event timestamps corroborate
  that it's live.
