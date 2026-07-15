# METS Demo Video — 5-minute shot list

Recorded, not live: every AI beat is guaranteed to land, dead air gets cut,
and the outage take can be re-rolled until it's perfect. Record segments
separately; stitch in order. The full feature inventory at the bottom is
the source of truth for what exists — the video shows the best of it.

## Recording prep

1. Start Docker Desktop, then from the repo root:
   ```sh
   npm run db:seed     # near-breach SLA meters are staged relative to seed
                       # time — reseed right before recording. The quarterly
                       # access review schedule also fires within ~5 min of
                       # boot — catch it for segment 6 or reseed to re-arm.
   npm run dev
   ```
2. Browser at 1920×1080, **dark mode**, bookmarks bar hidden, acting user
   = Justin Rhoda. Terminal ready at `server/` for
   `npm run demo:traffic -- outage`. Have a screenshot PNG on the desktop
   for the attachment beat.
3. `.env`: `AI_PROVIDER=claude` + key. Cut AI wait time in editing, but
   leave a beat of spinner visible — it reads as live, not mocked.
4. Voiceover: script business outcomes, not UI mechanics. Record VO after
   picture lock; segments below have suggested lines.

---

## SEGMENT 1 — The hook (0:00–0:35)

**Shots:** queue board in dark mode, slow pan (🚩 flags and 😤 sentiment
icons riding high in the score column); drag a ticket onto an agent
(status flips); drag another to the **Holding area → the calendar pops** —
click Monday, type a reason, gone until 8:00 that morning.

**VO:** "ServiceNow costs us about $300,000 a year. This is METS — one web
app, one Postgres database, roughly $8,000 a year in infrastructure. This
is our real queue: scored, SLA-timed, drag-and-drop — even snoozing is a
drag and a calendar click. But none of that is why I built it."

## SEGMENT 2 — Plain-language intake (0:35–1:20)

**Shots:**
1. + New Ticket. Subject + description including *"…this is for Hannah
   Hall at the Phoenix warehouse — her Zebra scan gun battery won't hold a
   charge"* — and **attach a photo** of the battery. No category picker,
   no queue picker, no on-behalf dropdown.
2. Routing screen resolves: Queue / Category / Priority / **Filed for:
   Hannah Hall\*** / **Attached: 1 file**, "routed automatically at 95%
   confidence."
3. Quick request-type ticket ("need a second monitor") → **"Hardware
   requests need a manager sign-off — sent to [manager] for approval."**
   Approve it from the banner.

**VO:** "Nobody picks categories or queues — you describe the problem,
attach the photo, done. The AI routes it, sets priority by business
impact, and noticed this ticket is really for Hannah — it's filed under
her name, her site, her SLA. Equipment requests? Parked until her manager
approves. The org chart is wired in."

## SEGMENT 3 — The outage (1:20–2:30) ★ THE CENTERPIECE

**Shots:**
1. Terminal: `npm run demo:traffic -- outage`. Four "Zoom is down" tickets
   from four people hit the queue (sort by newest).
2. The ⚠️ toast fires and the amber **SUSPECTED INCIDENT** banner appears
   app-wide (portal too — requesters see the known outage and stop filing
   duplicates). The P1 parent **"Suspected incident: Zoom outage"** carries
   the AI-written responder summary and four linked tickets. *(Bonus frame:
   the Security queue's `soc@` inbox in the Email tab already has
   queue-entry alerts from earlier phishing tickets.)*
3. Open one child: SOTO Bot already told the requester "you're not alone."
4. Type one update on the parent → toast: "broadcast to 4 linked tickets"
   → cut to a child showing it landed.
5. Resolve the parent → cascade toast: "4 linked tickets closed &
   requesters notified" — every child closes with a SOTO comment, banner
   clears. (A still-broken requester just replies; their ticket reopens.)

**VO:** "Four people just reported the same outage. Nobody triaged
anything. The system recognized one root cause, declared a suspected
incident at P1, put a banner in front of the whole company, wrote the
responder summary, and told every requester they weren't alone. One
update from me — all four people just heard back. And when it's fixed,
one status change closes every linked ticket and tells everyone. In
ServiceNow this is a consulting engagement."

## SEGMENT 4 — It gets smarter (2:30–3:15)

**Shots:**
1. Expand a mis-filed ticket → **⚑ Flag → Wrong category → Facilities** →
   toast: "the AI learns from this correction." *(The same panel handles
   wrong user, forced approvals, and misroutes.)*
2. Time-cut: a similar ticket routes to Facilities on its own; decision
   log shows the confidence.
3. Resolve a ticket with a real fix → KB tab: **"✨ AI drafts awaiting
   review"** → Publish → search for it by *meaning* → top hit.

**VO:** "Agents teach it in one click — corrections become patterns it
follows immediately. And when a ticket resolves with a reusable fix, the
AI drafts the knowledge-base article itself. Every resolved ticket makes
the next one faster."

## SEGMENT 5 — Requesters and accountability (3:15–4:00)

**Shots:**
1. In the search box, type **"open printer tickets in phoenix older than a
   week"** and press Enter → the ✨ chip shows the parsed filters, 130
   rows become 3.
2. Switch acting user to a requester → the Support Portal: their tickets,
   plain-language status, attach-a-screenshot, reply-to-reopen. Rate a
   resolved ticket ★★★★★.
3. Cut to Dashboards: CSAT tile + distribution, SLA attainment, the **TP
   Leaderboard** with its quality columns (Week/Month/Quarter toggle).

**VO:** "Agents search the queue in plain English. Requesters get real
self-service — their tickets only, enforced server-side, with satisfaction
ratings built in. And leads get the accountability layer: SLA attainment,
response times, and a leaderboard where Ticket Points reflect difficulty —
with the quality stats that keep it honest."

## SEGMENT 6 — The no-code close (4:00–5:00)

**Shots (rapid montage, ~5s each):**
1. Admin → Scoring: change a weight → "141 open tickets rescored."
2. Add a **flag keyword** ("printer" +25) → 🚩 flags appear instantly.
3. **Escalation card → Run sweep now** → "Escalated 25: 5 by expertise,
   20 round-robin — queue leads pinged in chat." *(One click worked the
   whole stale backlog.)*
4. **Recurring tickets** card — the quarterly access review that filed
   itself this morning, next run in October.
5. Queue email notifications — the SOC list on Security & Access.
6. *(Optional 5s of levity: the 🔇 ALL-CAPS penalty — "and tickets typed
   in all caps automatically lose points.")*
7. Close card: **$300k → three-year scenarios**, requirements checklist,
   production path (Entra SSO one app-registration away, Graph mail,
   migration) behind config-swap adapters.

**VO:** "Every knob ServiceNow charges consultants and change windows for
is a click here — audited, instant. Scheduled maintenance files its own
tickets. Stale work escalates itself to the right expert. METS: built in
a week, and it gets smarter every day we use it."

---

## Full inventory — everything built (for Q&A and the description)

**Queue & workflow:** drag-and-drop assign/re-queue/snooze (calendar
picker, wakes 8:00), bulk actions, select-all, collapsible rails that
auto-expand mid-drag, condensed responsive layout down to phones, deep
links, dark/light themes, clickable-logo home.

**AI (seven workflows, all audited + revertible):** triage
(category/queue/priority with per-field confidence), correction learning
loop (category, queue, priority, *and* wrong-user), on-behalf-of
detection from plain text, suspected-incident detection (app-wide amber
banner, absorb toasts, resolve-cascade) with parent/child +
broadcast, KB article drafting from resolutions, KB-grounded draft
replies, natural-language queue search. Mock fallback for every feature;
daily token budget; usage logged per feature.

**SLA & scoring:** business-hours engine (DST-safe, pause on pending),
warn/breach sweep with score escalation, admin-tunable weights —
priority, age, VIP, SLA, flag keywords, sentiment (😤/⚡ boosts, 🔇
ALL-CAPS penalty), manual boost.

**People flows:** manager approvals (category gates + org chart, forced
via flag), on-behalf filing, out-of-office agents (assignment-proof),
expertise auto-assign with fit % (auto-derived skills + manual grants),
location-aware assignment, escalation sweep (score picks expertise vs
round-robin), watchers (+subscribe a colleague), agent chat with live
ticket links, merge duplicates with exact part-number guard.

**Requester experience:** self-service portal (server-enforced RBAC),
CSAT stars, reply-to-reopen, attachments/screenshots, SOTO Bot
acknowledgments + category auto-responses + approval/merge/incident
notifications.

**Comms & automation:** response templates with variables, auto-respond,
queue email notifications (once per ticket per queue), email pipeline
(threading, guest contacts, reopen-on-reply; mock transport), recurring
ticket schedules, auto-close of stale resolved tickets.

**Insight:** dashboards (volume, median MTTR/FRT, SLA attainment, CSAT +
distribution, backlog age, open-by-queue), TP leaderboard with quality
columns, AI decision log with agreement stats, notification bell with
per-type prefs.

**Foundations:** full audit trail on every change, role-based access
enforced server-side, Entra SSO built dormant (docs/SSO.md), attachment
storage adapter (type allowlist, size caps, authed access), honest
maturity/TCO story in PROPOSAL.md v2.0.

## Cut from the video (exists — one VO line covers them)

Chat, watchers, merge with the part-number guard, OOO handling, wrong-user
flag, queue notifications detail, collapsible rails, templates. VO:
"…plus agent chat, watchers, duplicate merging with part-number
safeguards, and a dozen more features ServiceNow sells as add-ons."

## Retake / sanity notes

- Anything weird with data → `npm run db:seed` resets in ~10 seconds; it
  also re-arms the quarterly schedule and the two unread chat messages.
- The incident segment needs 3 similar same-category tickets within 2h —
  rerun after reseed if a take goes sideways; a second run absorbs into
  the open incident, which is also demoable.
- Escalation ships disabled by design (the seeded backlog is days old) —
  the Run-sweep-now click *is* the demo; reseed afterward to restore the
  Unassigned view.
- AI latency: cut it, keep spinners for a beat. Event timestamps
  corroborate that it's live.
