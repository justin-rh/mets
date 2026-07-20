# Top-8 presentation — 15-minute run-of-show (live demo)

15 minutes **inclusive of Q&A**: ~10:15 of content, protect ~4:45 for
questions. The narrative spine is an **escalation ladder of judgment** —
say it in the open, land every beat on it, repeat it in the close:

> Rules route the deterministic tickets for free → a mid-tier model routes
> the routine ones for about a penny → the big model handles uncertainty →
> humans stay in charge, and the system learns from every correction.

---

## Pre-stage checklist

**Morning of** (see DEMO-DAY.md for infra: static IP, firewall, Docker):

- [ ] `start-demo.ps1` → READY; health shows `ai=claude`.
- [ ] `reset-demo.ps1` (~2 min), then `python scripts\demo-tickets.py` —
      note the cheat-sheet ticket numbers.
- [ ] Admin → AI & Automation: **AI enabled ON**, **Show SOTO's work ON**,
      bypass card → **Scan now** (populates "SOTO suggests" from the fresh
      seed — expect ~10 patterns).
- [ ] Dashboard numbers match whatever the deck quotes (accuracy %, spend).
- [ ] Sanity pass: file one throwaway ticket, watch the signals reveal,
      confirm routing. Reset again if anything looks off.
- [ ] Find the **suggest-fix hero ticket**: open "FedEx rate quotes failing
      in shipping software" (or similar open ticket with resolved
      lookalikes), press 💡 Suggest fix once NOW — the result caches, so
      the live click is instant even if the API hiccups. Verify it cites
      past tickets.
- [ ] Cheat sheet on paper: the Spanish AND Databricks ticket numbers +
      their requesters' names (two portal acting-as switches), the
      Databricks paste-reply block from demo-tickets.py's cheat sheet,
      and the hero ticket number. All eight scenarios stage by default.
- [ ] **API playground** (`/api/playground`, background tab): API key
      pasted once (it persists in the browser; keys survive resets), fetch
      a ticket to confirm. For the beat: paste the number of a ticket from
      an earlier demo beat, toggle **Live**, reply in METS on the other
      tab — the playground updates in ~3s.

**T-minus ~3 minutes (right before you're called up):**

- [ ] Press **⚠️ Incident Demo**. It brews 1–6 minutes — the banner should
      erupt mid-presentation as your planned interruption. If it lands
      early, fine: "you can see there's a live incident — we'll come back
      to it."
- [ ] Browser 1920×1080, dark mode, acting user Justin Rhoda, welcome card
      dismissed, Admin and Dashboard tabs pre-opened in background tabs.

**Standing rules during the demo:** never edit source files (hot reload
flashes every screen); if the API dies, its minimized window says why and
`start-demo.ps1` restarts only what's down.

---

## Beats

### 0:00–1:30 · Cold open (slides, no demo)
ServiceNow ~$300k/yr and every workflow change is a consulting
engagement. Built in one week, solo, with Claude Code. It's running live
on this network. Thesis line: *"The interesting part isn't that it has AI
— it's that the AI is measured, auditable, and spends money like an
engineer."*

### 1:30–2:30 · The board — every road leads here (60s)
Scored, SLA-timed queue. **Drag a ticket onto an agent** (assigned),
**drag one to another queue** — *"and that drag is training data: SOTO
learns routing from corrections."* Point at the staged **email ticket**
(forklift charger): *"this one arrived as an email — same pipeline,
same AI."* Then the **mention ticket**: gold ring on Derek in Suggested
(*"the requester named him"*) → drag to **Auto-assign (Mentioned)** →
assigned. Undo exists; don't dwell.

- *Fallback:* none needed — no AI runs live in this beat.

### 2:30–4:15 · Screenshot triage + SOTO's work (centerpiece, ~1:45)
**+ New Ticket** → subject blank → description "keeps happening,
screenshot attached" → **Ctrl+V the error screenshot** → Create. While
the spinner runs: *"No subject, no category picker — one sentence and a
paste."* Payoff: the **signals reveal** one by one (error code quoted off
the image → the company-terminology fact → impact), **confidence
meters**, AI-written subject. Then flick the **"Wrong queue? Move it"**
dropdown one beat: *"one click to correct, and it becomes a pattern."*
Cost line: *"about a penny."*

- *Watch:* routing follows the image content — glance before narrating.
- *Fallback:* the staged screenshot ticket from demo-tickets.py shows the
  same signals/confidence UI in ticket detail ("How SOTO read it").

### 4:15–5:30 · The incident interruption (~75s)
The banner + toast should have landed by now. Ride it: click the banner →
parent ticket, linked children, every requester already commented
"you're not alone." **Reply once on the parent** → show it broadcast to a
child. Then open any ticket's **Flag menu** → point at **⚡ Escalate to
incident** (admin-only): *"and we don't wait for the detector — an admin
can declare this instantly, no AI call; the human is the confidence
gate."* (Point, don't submit — one banner on screen is enough.) **Resolve the parent** →
children cascade closed, banner clears.

- *Fallback:* if the burst hasn't declared yet, invert the beat: flag one
  of the burst tickets as an incident manually (instant banner), and let
  the auto-declaration be the Q&A encore.

### 5:30–6:30 · Institutional memory (~60s)
Open the hero ticket → **💡 Suggest fix** (cached = instant) → SOTO's
proposed fix **citing the past tickets it came from** ("Worked before in
T-…"), with an honest caveat → **↳ Insert into reply**. Line: *"This was
on my roadmap slide last round — it shipped. Every resolution this team
has ever made is now working capital: 665 resolved tickets are embedded
as searchable memory, locally, for free."*

### 6:30–7:45 · Guided intake — the Databricks ticket (~75s)
Expand the staged **"Databricks problem"** ticket: deliberately vague,
and SOTO has already posted its intake questions (the old flow relayed
these through the Service Desk). Switch acting user to the requester
(cheat sheet), open the portal, **paste the scripted reply block** →
back as agent: SOTO parsed the answers, routed to the **Data Team**, and
left the Question/Answer handoff table as an internal note. *"Nobody
asked twice — SOTO collected exactly what the ticket didn't say."*

- *Fallback:* if the parse is slow, narrate the questions SOTO already
  asked and move on; the routed state can be shown in Q&A.

### 7:45–8:45 · The Spanish ticket (~60s)
Expand the staged Spanish printer ticket — 🌐 TRANSLATED FROM SPANISH
block. Reply in English → you're already acting as a requester-switch
veteran from the last beat: switch to the Spanish requester (cheat
sheet) → portal shows the reply **in Spanish**. *"Nobody translated
anything. A third of our warehouse writes in Spanish — the language
barrier just isn't there."*

- *Watch:* the acting-as switch is part of the demo, not a bug — say so.

### 8:45–9:45 · The money, live (~60s)
**Dashboard**: impact headline (N routed hands-free · spend $X),
**routing accuracy measured against agent corrections** — not projected —
per-feature cost table (cache discounts included). Then **Admin → AI
triage bypass**: the **"SOTO suggests"** list → **accept one rule on
camera**. Line: *"Deterministic tickets route for free, routine ones cost
about a penny on the mid-tier model, only uncertainty pays for the big
model — and the system just asked me to cut its own bill."*

### 9:45–10:15 · Close
The ladder in one breath. Everything else exists too (SLAs, approvals,
RBAC, API, ServiceNow CSV import — one slide, no demo). Pilot ask.
*"Questions — and if you want, file a ticket at the URL on screen while
we talk; watch the queue."*

---

## Q&A back pocket (rehearse each as a 30-second move)

| Question | Move |
|---|---|
| Vendor lock-in / "what if Claude goes away?" | Flip the **AI kill switch** (Admin → AI & Automation), file a ticket, it still routes on keyword rules, health shows `mock`. Flip back. One file implements the provider; docs/AI-PORTABILITY.md has the table. |
| "What happens when the AI is wrong?" | AI Triage decision log: every decision, confidence, status; corrections feed the next prompt. Show a ticket whose "How SOTO read it" says *expanded profile (escalated)* — it spends more only when unsure. |
| Cost at 10× volume? | Dashboard per-feature table; daily token budget cap; bypass rules bend the curve down as patterns accumulate; model tiers are .env knobs. |
| Data privacy / what leaves the building? | Ticket text goes to the API for the AI features only; embeddings are local; kill switch = nothing leaves. (Enterprise API terms: no training on our data.) |
| Migration off ServiceNow? | CSV import demo (Admin) — history, legacy numbers ride along and stay searchable. |
| "How would our other systems integrate?" | **/api/playground**: one vanilla-HTML file against the public API. Paste a ticket number → the actual HTTP calls with latency → parsed ticket + raw JSON. Toggle Live, reply in METS, watch it update. Legacy trick: paste an old SNOW number (INC0010081) — imported tickets answer to their old names. Full spec at /api/docs. |
| "People report problems in chat, not tickets" | Agent chat (💬): exchange two messages, hit **📎 → ticket** — the transcript becomes the description, the person you're chatting with becomes the requester, AI titles and routes it, and a linkified confirmation lands back in the thread. Work stops hiding in chat. |
| One-person bus factor? | Boring stack (one web app, one Postgres), typed end to end, every AI behavior is config not code, docs/ folder; honest-debt list in PROPOSAL.md. |
| "Can the app itself be in Spanish?" | The content pipeline already is — tickets translate inbound, replies translate back, triage classifies from meaning. The portal *chrome* is a scoped ~2-day roadmap item (the requester surface is ~3 components / ~100 strings), done portal-first because that's where our Spanish speakers live. Agent UI stays English. |
| Weekly briefing / problem management | Dashboard briefing card — SOTO reads the whole queue weekly and names the recurring problems worth root-causing, including ones with no KB article. |

## Deliberate cuts (exist — mention, don't demo)
Kill switch mid-demo (risk: forgetting to flip back), weekly briefing,
merge with part-number guard, the Email-tab simulator view (the email
ticket itself is in beat 1), NL queue search, approvals, VIP scoring,
snooze (the new-hire ticket stays staged if a snooze moment presents
itself), TP leaderboard, CSAT, templates, recurring tickets (pair
naturally with bypass rules if asked).
