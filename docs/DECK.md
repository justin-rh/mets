# METS — Judge Deck (5 slides)

Source of truth for the judging deck. Numbers are pulled from the live
system (dashboard) and docs/PROPOSAL.md — re-check the dashboard the
morning of judging in case the live figures have moved.

---

## Slide 1 — Problem: We rent a ticketing system we fight with

- ServiceNow costs **~$300k/year** — and every workflow change is a
  consulting engagement on top.
- Agents spend their time **routing** tickets, not **fixing** them:
  manual categorization, priority guessing, the Service Desk relay
  ("which tables do you need access to?").
- Requesters get a form with 12 dropdowns and a black hole afterward.
- Over 3 years, that's **~$950k** for software that still makes a human
  read every ticket first.

*Visual: one screenshot of a real SNOW intake form next to the METS
New Ticket dialog (subject optional, no category picker).*

---

## Slide 2 — Approach: Describe the problem. The system does the rest.

- **METS**: built in one week, solo, with Claude Code — AI-native, not
  AI-bolted-on.
- **Every new ticket is read by AI the moment it lands**: category,
  queue, and priority assigned in seconds — applied automatically above
  a confidence bar, held for a human below it, every decision logged and
  one click to revert. Corrections become routing patterns it follows
  (dragging a ticket to the right queue *is* training).
- Nine AI workflows on one pipeline: triage (reads screenshots, writes
  subjects, spots "filed for someone else"), self-service deflection,
  outage detection, KB drafting, guided intake, bilingual tickets,
  weekly problem briefing, natural-language search, draft replies.
- Everything else a helpdesk needs is real too: SLAs, approvals,
  escalations, RBAC, public API, ServiceNow import.

*Visual: the AI Triage decision log — decisions, confidence, outcomes.*

---

## Slide 3 — Demo highlights (in the video and live to try)

- **Paste a screenshot; no category, no subject** → routed at 97%
  confidence, subject written, the error code read *from the image*.
- **Three "Zoom is down" reports** → one suspected incident, company-wide
  banner, every requester told "you're not alone" — one status change
  closes them all. Live in one click: the ⚠️ Incident Demo button.
- **"VPN keeps dropping"** → SOTO Bot replies with the fix from the KB;
  requester says "solved"; ticket closes with **zero agent involvement**.
- **Databricks access request** → SOTO asks only the questions the
  ticket didn't answer, then routes straight to the Data Team.
- **A ticket arrives in Spanish** → the agent reads and replies in
  English; the requester gets it back in Spanish — nobody translates
  anything.

*Visual: one screenshot per bullet from screenshots/ — this slide should
be almost all images.*

---

## Slide 4 — Business impact

- **~$210k+/year saved** vs the ServiceNow renewal (3-yr TCO scenarios:
  ~$90k–$320k vs ~$950k — PROPOSAL.md).
- AI routing: **88% accuracy · 80% fully automatic** — measured from the
  audited decision log, not projected.
- AI cost: **~2¢ to triage a ticket; ~$11/month at demo volume** — a
  rounding error that scales linearly.
- Self-service deflection + bot-stamped first responses = agent hours
  back on real work.
- **No consultant tax**: keywords, SLAs, approvals, VIPs, queues — all
  admin-panel settings, changed live.

*Visual: the dashboard AI scoreboard tiles (accuracy / automatic /
week-over-week / spend).*

---

## Slide 5 — What's next

- **On the roadmap**: routing that learns from every past resolution
  (similar-ticket grounding), AI-suggested fixes surfaced to agents as
  they work, and asset tracking tied to tickets.
- **Two activations, not builds**: Entra SSO and the shared-mailbox
  email adapter are written and dormant — each needs one app
  registration (docs/SSO.md, docs/EMAIL.md).
- **Migration day is a CSV upload** — history, ticket numbers, and
  requesters come along.
- **Honest debt, documented**: durable job queue, embedding scale-up,
  retention policies (PROPOSAL.md keeps the full list).
- **The learning loop compounds**: every correction and every published
  KB article makes next month's system better than this month's.
- **Try it yourself during judging**: http://10.164.0.234 — file a
  ticket, press ⚠️ Incident Demo.

*Visual: the pilot timeline as a simple 3-step arrow: pilot queue →
measure → migrate.*

---

## Speaker framing (not on slides)

- Slide 4 leads with dollars because that's the ranking criterion; the
  "measured, not projected" line is the differentiator against any
  "we'll add AI" pitch.
- Slide 5's honest-debt bullet preempts "is this production-ready?" —
  answer it before it's asked.
- If asked about risk: every AI action is audited and revertible; the
  mock adapters mean the system degrades gracefully, never hard-fails.
