# AI portability — what if we leave Claude?

The panel question: *"You've built this on one vendor's AI. What happens if
you switch providers, or drop AI entirely?"* The short answer: the AI is a
**plug-in, not a foundation**. Three exit paths, cheapest first.

## 1. Turn AI off — takes one click, right now

Admin → AI & Automation → **AI enabled** master switch (or
`AI_PROVIDER=mock` in `.env`). Every AI feature degrades to a built-in
keyword engine and the helpdesk keeps running: queues, SLAs, scoring,
approvals, escalations, routing rules, bypass rules, recurring tickets,
merge, chat, notifications, the API — none of it touches a model.

What degrades, and to what:

| Feature | With Claude | With AI off |
|---|---|---|
| Triage | Reads text + screenshots, writes subjects, translates | Keyword rules route by category patterns |
| Deterministic tickets | Bypass rules (no AI either way) | Identical — unaffected |
| KB search | Hybrid FTS + local embeddings | Identical — embeddings are local, not Claude |
| Self-service deflection | Article-grounded fix steps | Word-overlap match, article excerpt |
| NL queue search | Full natural language | Keyword parse |
| Reply drafting / KB drafts / weekly briefing | Written by the model | Template stubs / heuristic summaries |
| Spanish tickets | Auto-translated both ways | Shown untranslated |

Every degradation is graceful — nothing hard-fails. This is also the
system's behavior today whenever the daily token budget trips.

## 2. Swap providers — one file, roughly a day

The entire vendor dependency lives in **one file**:
`server/src/services/ai/provider.ts`. It defines an `AIProvider` interface
with nine operations (triage, draft reply, incident assessment, KB draft,
search parse, guided intake, deflection, resolution suggestion, digest,
translate) with typed inputs and outputs. Eleven consumers across the
codebase call `getAIProvider()` — none of them import the Anthropic SDK or
know which vendor is behind the interface. Two implementations exist today
(Claude and the keyword mock), which is the proof the seam is real.

Porting to OpenAI / Gemini / a self-hosted model = writing a third
implementation of those nine methods:

- **Prompts** are plain text — they move as-is (company terminology,
  rubrics, the environment profiles).
- **Structured outputs** (the JSON-schema responses every operation uses)
  exist on all major providers.
- **Vision** (screenshot reading) exists on all major providers.
- **Embeddings are already local** (MiniLM via transformers.js) — KB search
  and similar-ticket grounding don't change at all.
- Provider-specific bits that simply don't port: prompt-cache markers
  (each vendor has its own caching), model-tier env names, per-model
  pricing in the dashboard map. Each is a small, contained edit.

Expect a day of implementation plus an evaluation pass — and the routing
accuracy dashboard measures the new provider against agent corrections the
same way it measures Claude today, so the swap is verifiable, not vibes.

## 3. Mix and match

Model choice is already per-feature (`AI_MODEL`, `AI_MODEL_TRIAGE`,
`AI_MODEL_LIGHT` env knobs). The same pattern extends to per-feature
providers if pricing ever favors it — e.g. a local model for translation,
a hosted one for drafting.

## Why this was cheap to have

Ports and adapters. Auth (`dev`/`entra`), mail (`mock`/`smtp`), storage,
and AI are all swappable adapters reported on `/api/health`. The AI
adapter is just the one that gets the demo time.
