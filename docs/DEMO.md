# METS Demo Video — 5-minute shot list

Recorded, not live: every AI beat is guaranteed to land, dead air gets cut,
and the outage take can be re-rolled until it's perfect. Record segments
separately; stitch in order.

## Recording prep

1. Start Docker Desktop, then from the repo root:
   ```sh
   npm run db:seed     # near-breach SLA meters are staged relative to seed
                       # time — reseed right before recording
   npm run dev
   ```
2. Browser at 1920×1080, **dark mode** (pops on video), bookmarks bar
   hidden, acting user = Justin Rhoda. Keep a terminal ready at `server/`
   for `npm run demo:traffic -- outage`.
3. `.env`: `AI_PROVIDER=claude` + key. Cut AI wait time in editing, but
   leave a beat of spinner visible — it reads as live, not mocked.
4. Voiceover: script business outcomes, not UI mechanics. Record VO after
   picture lock; segments below have suggested lines.

---

## SEGMENT 1 — The hook (0:00–0:30)

**Shots:** queue board in dark mode, slow pan; drag a ticket onto an agent
(status flips); drag another onto MERP in the right rail.

**VO:** "ServiceNow costs us about $300,000 a year. This is METS — one web
app, one Postgres database, roughly $8,000 a year all-in. This is our real
queue: scored, SLA-timed, drag-and-drop. But none of that is why I built it."

*(That last line sets up the AI segments — the board is table stakes.)*

## SEGMENT 2 — Plain-language intake (0:30–1:15)

**Shots:**
1. + New Ticket. Type subject + description that includes: *"…this is for
   Hannah Hall at the Phoenix warehouse — her Zebra scan gun battery won't
   hold a charge."* No category picker. No queue picker. No "on behalf of"
   field. Create.
2. The routing screen resolves: Queue / Category / Priority / **Filed for:
   Hannah Hall\* — detected from your description**, "routed automatically
   at 95% confidence."
3. Quick second ticket, type = Request, "need a second monitor" → routing
   screen shows **"Hardware requests need a manager sign-off — sent to
   [manager] for approval."** Open it, approve from the banner.

**VO:** "Nobody picks categories or queues — you just describe the problem.
The AI routes it, sets priority by business impact, and even notices when
you're filing for someone else. Equipment requests? Parked until the
requester's own manager approves — the org chart is wired in."

## SEGMENT 3 — The outage (1:15–2:30) ★ THE CENTERPIECE

**Shots:**
1. Terminal: `npm run demo:traffic -- outage`. Four "Zoom is down" tickets
   from four different people hit the queue (sort by newest).
2. The P1 parent appears: **"Major incident: Zoom outage —
   company-wide"** with the AI-written responder summary and four linked
   tickets. Open it — banner with child chips.
3. Open one child: SOTO Bot has already told the requester "you're not
   alone — we're treating this as one incident."
4. Back on the parent, type one update ("bad firewall rule, rolling back,
   15 minutes") → toast: "Update broadcast to 4 linked tickets." Cut to a
   child ticket showing the update landed.

**VO:** "Now the part I'm proudest of. Four people just reported the same
outage. Nobody triaged anything. The system recognized one root cause,
declared a P1 incident, wrote the responder summary, and told every
requester they weren't alone. One update from me — and all four people
just heard back. In ServiceNow this is a consulting engagement. Here it's
emergent behavior."

*(Retake note: detection needs 3 similar same-category tickets within 2h.
If a take goes sideways, reseed and rerun — a second run absorbs into the
existing incident, which is also demoable.)*

## SEGMENT 4 — It gets smarter (2:30–3:15)

**Shots:**
1. Expand a ticket the AI put in the wrong place → **⚑ Flag → Wrong
   category → Facilities** → toast: "the AI learns from this correction."
2. Create a similar ticket (or time-cut to one) — it routes to Facilities
   on its own. Show the decision log line with confidence.
3. Resolve a ticket that has a real fix in the thread → KB tab: **"✨ AI
   drafts awaiting review (1)"** → open, Publish → search for it by
   *meaning* (different words than the title) → top hit.

**VO:** "Agents teach it in one click — corrections become patterns it
follows immediately. And when a ticket resolves with a reusable fix, the
AI drafts the knowledge-base article itself. Every resolved ticket makes
the next one faster."

## SEGMENT 5 — Requesters and accountability (3:15–4:00)

**Shots:**
1. Switch acting user to a requester → the whole app becomes the Support
   Portal: their tickets, plain-language status, the conversation.
2. Rate a resolved ticket ★★★★★ with a comment.
3. Cut to Dashboards: CSAT tile + distribution, SLA attainment, median
   response times, then the **TP Leaderboard** (Week/Month/Quarter toggle,
   quality columns).

**VO:** "Requesters get real self-service — their tickets only, enforced
server-side, with satisfaction ratings built in. Leads get the other half:
SLA attainment, response times, and a leaderboard where Ticket Points
reflect difficulty — with the quality stats that keep it honest."

## SEGMENT 6 — The no-code close (4:00–5:00)

**Shots (rapid montage, ~5s each):**
1. Admin → Scoring: change a weight → "141 open tickets rescored" → queue
   visibly reorders.
2. Add a flag keyword ("printer" +25) → 🚩 flags appear instantly.
3. Toggle an approval gate on a category.
4. Response templates card (auto-respond = SOTO Bot).
5. *(Optional 6s of levity: the 🔇 ALL-CAPS penalty field — "and tickets
   typed in all caps automatically lose points.")*
6. Close card / final frame: **$300k → ~$8k/yr**, requirements checklist
   (queue ✓ AI ✓ SLA ✓ KB ✓ dashboards ✓ email ✓ RBAC ✓ approvals ✓),
   production path: Entra SSO, Graph mail, migration — designed behind
   config-swap adapters.

**VO:** "Every knob ServiceNow charges consultants and change windows for
is a click here — audited and instant. METS: built in a week, roughly
$8,000 a year, and it gets smarter every day we use it."

---

## Cut from the video (exists, not differentiating in 5 min)

Email round-trip (worth 5s of b-roll if pacing allows), agent chat with
ticket links, merge-duplicates with the part-number guard, snooze/holding
area, OOO handling, collapsible rails, on-behalf tooltips. One VO line
covers them: "…plus a dozen quality-of-life features ServiceNow makes you
pay extra for."

## If judges ask "what's next" (specs written, tasks queued)

- Escalation rules (stale unassigned P1 → queue lead pinged)
- Ticket watchers, recurring/scheduled tickets, natural-language queue
  search
- Entra SSO — the auth adapter is built for it; one app registration away

## Retake / sanity notes

- Anything weird with data → `npm run db:seed` resets in ~10 seconds;
  reseed between takes that mutate demo state.
- The incident segment is the only multi-step take — record it last, after
  a fresh reseed, so everything else is already in the can.
- AI latency: cut it, but keep spinners for a beat. Timestamps on events
  corroborate that it's live.
