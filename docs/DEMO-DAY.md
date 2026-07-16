# Demo-day preflight

## The night before

- [ ] **Static IP**: reserve the demo machine's address on the router (or set
  it manually). It has already drifted once (10.164.1.7 → 10.164.0.234) —
  a printed URL that 404s is the worst possible open. `start-demo.ps1`
  prints whatever the current IP is.
- [ ] **Firewall**: `New-NetFirewallRule -DisplayName "METS demo" -Direction
  Inbound -Protocol TCP -LocalPort 80 -Action Allow` (admin PowerShell),
  then load `http://<ip>/` **from a phone on the same network** — testing
  from the machine itself doesn't exercise the firewall.
- [ ] **Docker Desktop**: Settings → General → "Start Docker Desktop when
  you sign in". It died once mid-week; don't rediscover that live.
- [ ] Windows Update: pause it. Power settings: never sleep.

## Morning of

- [ ] `powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1`
  — boots Docker → Postgres → API → web, prints the judge URL, and warns
  if the AI adapter isn't claude.
- [ ] `powershell -ExecutionPolicy Bypass -File scripts\reset-demo.ps1`
  — fresh baseline (~2 min; embeddings rebuild). Run BEFORE judging or
  between video takes, never during.
- [ ] Sanity pass: file one throwaway ticket, watch it triage, delete
  nothing — then reset again.
- [ ] Token budget: `AI_DAILY_TOKEN_BUDGET=2000000` covers ~400+ triages;
  if AI responses ever look keyword-dumb, the budget tripped and the mock
  took over — check `/api/health` and the ai_usage totals.

## While judges are connected

- **Do not edit source files** — hot reload flashes every connected screen.
- Everyone arrives as Justin Rhoda (dev auth); the acting-as switcher is
  part of the demo, not a bug.
- If the API dies: its minimized PowerShell window shows why; rerun
  `start-demo.ps1` (it skips whatever is still up).
- Preserved across resets: AI spend history, the weekly briefing, API keys.
  Everything else (tickets, incidents, VIP edits) returns to baseline.

## Recording the video

- Reset between takes; wait for the READY line.
- `python scripts\demo-tickets.py` stages the eight scripted demo tickets
  (screenshot-only vision, inbound email, August new-hire snooze, TMP-drive
  KB, Derek mention, AutoStore keyword, Databricks intake, Spanish) and prints a cheat sheet of
  which ticket demos which beat. Rerun it after every reset — numbers change
  each time. `--screenshot <path>` swaps in your own image for the vision
  ticket; a scenario name as an argument files just that one.
- The incident declaration takes 1–6 minutes after the burst — film other
  segments while it brews, or pre-declare and reopen via SQL if takes are
  tight.
- Numbers quoted in the deck (accuracy %, spend) should match the
  dashboard on the day — reseed regenerates them deterministically.
