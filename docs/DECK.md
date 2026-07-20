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
- Ten AI workflows on one pipeline: triage (reads screenshots, writes
  subjects, shows its work, spots "filed for someone else"), self-service
  deflection, outage detection, KB drafting, fix suggestions grounded in
  past resolutions, guided intake, bilingual tickets, weekly problem
  briefing, natural-language search, draft replies.
- **It spends like an engineer**: admin rules route deterministic tickets
  for free (and SOTO suggests those rules itself), a mid-tier model
  handles routine triage, the big model is pulled in only below the
  confidence gate — plus a one-click AI kill switch that degrades
  everything to keyword rules.
- Everything else a helpdesk needs is real too: SLAs, approvals,
  escalations, RBAC, public API, ServiceNow import.

*Visual: the AI Triage decision log — decisions, confidence, outcomes.*

---

## Slide 3 — Demo highlights (all live — see docs/RUN-OF-SHOW.md)

- **Paste a screenshot; no category, no subject** → SOTO shows its work
  signal by signal, routes with per-field confidence, writes the subject
  with the error code read *from the image*.
- **Three "Zoom is down" reports** → one suspected incident, company-wide
  banner, every requester told "you're not alone" — one status change
  closes them all. And agents don't wait for the detector: **Flag →
  Escalate to incident** does it instantly, no AI needed.
- **💡 Suggest fix** → SOTO proposes the resolution *cited from the past
  tickets that fixed it* — 665 resolutions embedded locally as searchable
  institutional memory.
- **A ticket arrives in Spanish** → the agent reads and replies in
  English; the requester gets it back in Spanish — nobody translates
  anything.
- **"SOTO suggests"** → it notices ticket patterns it keeps routing the
  same way and proposes bypass rules to stop paying for its own calls.

*Visual: one screenshot per bullet from screenshots/ — this slide should
be almost all images.*

---

## Slide 4 — Business impact

- **~$210k+/year saved** vs the ServiceNow renewal (3-yr TCO scenarios:
  ~$90k–$320k vs ~$950k — PROPOSAL.md).
- AI routing: **88% accuracy · 80% fully automatic** — measured from the
  audited decision log, not projected.
- AI cost: **~1¢ for a typical ticket, $0 for rule-routed ones** — tiered
  models (cheap first, big only under the confidence gate), prompt
  caching, and self-suggested bypass rules bend the curve down as
  patterns accumulate. Every call metered per model on the dashboard.
- Self-service deflection + bot-stamped first responses = agent hours
  back on real work.
- **No consultant tax**: keywords, SLAs, approvals, VIPs, queues — all
  admin-panel settings, changed live.

*Visual: the dashboard AI scoreboard tiles (accuracy / automatic /
week-over-week / spend).*

---

## Slide 5 — What's next

- **Last round's roadmap, shipped**: similar-ticket grounding and
  AI-suggested fixes went live this weekend — you just saw them.
- **On the roadmap now**: asset tracking tied to tickets, problem
  management on top of the weekly briefing, a fully bilingual requester
  portal (ticket *content* already translates both ways — the portal
  chrome is a scoped ~2-day item), and per-feature provider mix
  (docs/AI-PORTABILITY.md — the vendor is a plug-in, not a foundation).
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
- If asked about vendor lock-in: flip the AI kill switch live (Admin →
  AI & Automation), file a ticket, it still routes — then flip it back.
  Rehearsed 30-second Q&A moves for this and more: docs/RUN-OF-SHOW.md.
