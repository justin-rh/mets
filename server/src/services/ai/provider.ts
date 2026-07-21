import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '../../config.js';

export const PROMPT_VERSION = 'triage-v9'; // v7: subject generation; v8: language + translation; v9: environment profile + signals

// Everything company-specific the model won't know from ticket text alone —
// systems, sites, terminology, and routing rules of thumb. Shared across the
// triage, search, incident, and intake prompts so they route consistently.
// This is the DEFAULT; admins edit the live copy (Admin → AI & Automation),
// which is stored in app_config and loaded over this at boot
// (services/ai/environment.ts). Teaching SOTO a new system is a form edit.
export const DEFAULT_ENVIRONMENT_PROFILE = `Master Electronics environment — company systems and terminology:

THE COMPANY
- Master Electronics is an electronic components distributor: connectors,
  switches, passives, and electromechanical parts from franchised
  manufacturers, stocked and shipped worldwide.
- Sites: Phoenix, AZ is HQ and the main distribution center. Warehouses:
  Phoenix, Germantown WI, Toronto. Branch and sales offices include Chicago,
  Miami, Ronkonkoma NY, Santa Clara and Santa Monica CA, Eden Prairie MN,
  Tampa, Redmond WA, with international teams in Mexico, Hong Kong, Malaysia,
  the Philippines, and Jordan; many corporate staff are remote. A ticket's
  site appears as a location tag (phoenix-az, germantown-wi, …).
- Much of the warehouse workforce writes in Spanish.
- AMAT is the Applied Materials key-account program with a dedicated team and
  queue — anything threatening AMAT orders or forecasts is high business impact.
- Vendors you'll see by name: TTI, Arrow, Digi-Key (suppliers); UPS, FedEx,
  and LTL carriers (freight).

CORE BUSINESS SYSTEMS
- MERP is the in-house ERP: order entry, inventory, pricing, EDI, patches.
  OMS is the web version of MERP, used by most warehouse users — OMS issues
  are MERP tickets, not a generic web problem. Order entry timing out or MERP
  down for a team is business-stopping.
- EDI (850 orders / 855 acks / 856 ASNs / 810 invoices) runs through MERP.
  Failed transactions with a customer or supplier are MERP-queue tickets and
  time-sensitive — unshipped EDI orders miss same-day cutoffs.
- CRM, quoting tools, and SaaS integrations belong to the Business
  Applications queue.
- Databricks is the data platform (tables, schemas, notebooks). Access
  requests get guided intake; broken reports and extracts → Data & Reporting.
- Power BI is the reporting/dashboard tool → Data & Reporting.
- UKG is the HR / payroll / timekeeping platform → People Operations.
- Concur is expense reporting → Finance & Accounting.

SECURITY & IDENTITY
- Sign-in is Microsoft Entra ID: password resets, lockouts, and MFA prompts
  are Access & Accounts unless an actual security incident is described.
- ZScaler is the company VPN / secure-access client. ZScaler problems are
  Network & VPN tickets, not a third-party app issue.
- Proofpoint is the spam / email-filtering platform, managed by the Security
  team. Quarantined or blocked email, spam getting through, and sender
  allow/block requests are Security tickets, not Email & Collaboration.
  This includes OUTBOUND mail: a user's outgoing emails being blocked or
  bounced is likely Proofpoint filtering — route to Security too.
- CrowdStrike is the endpoint security (EDR) agent — quarantine pop-ups and
  sensor alerts → Security.
- Keeper is the password manager (vault, autofill, sharing) → Security.
- Phishing here often imitates DocuSign signature requests or executive
  names. A user who CLICKED or entered credentials is a P1–P2 Security
  incident; merely receiving/reporting one is a normal Security report.

WAREHOUSE & LOGISTICS
- AutoStore is the automated storage & retrieval robot grid in the Phoenix
  DC. Port stoppages, bin errors, or grid faults stall picking — high
  impact, Warehouse Tech.
- RF scanners (handhelds) and warehouse Wi-Fi dead zones → Warehouse Tech.
  One flaky scanner is routine; a whole zone offline degrades the shift.
- Zebra printers (ZT411 and similar) print shipping and product labels at
  pack stations → Printing & Labels. Offset or misaligned labels usually
  mean media-sensor recalibration. Label printing down at shipping ahead of
  the carrier cutoff is urgent.
- UPS WorldShip / FedEx Ship Manager run at shipping stations; manifest or
  rating errors block shipping → Warehouse Operations.
- Receiving discrepancies, cycle counts, LTL, and value-add jobs are
  Warehouse Operations (a business process, not IT hardware).

EVERYDAY IT
- Standard stack: Windows laptops (Dell Latitude, Lenovo ThinkPad) with
  docking stations; Microsoft 365 (Outlook, SharePoint, OneDrive); Zoom for
  meetings and conference rooms; Slack for chat.
- The TMP drive (mapped as M:) is the shared network drive; "can't get into
  the TMP/M: drive" has a known registry fix in the knowledge base.
- NinjaOne is the endpoint-management agent (installs, patching).
  TungstenPDF is the standard PDF editor.
- Office printers: HP LaserJet on the sales floor, Brother in Accounting.
- ChatGPT / Claude access and automation requests → AI & Enablement.

BUSINESS RHYTHMS (priority context)
- Same-day shipping cutoffs are in the afternoon: anything blocking picking,
  labels, manifests, or EDI order flow late in the day is urgent.
- Month-end close: Finance issues near the end of the month carry deadlines.
- New-hire start dates are hard dates — late onboarding means a person
  sitting idle on day one.`;

// The CORE profile rides on EVERY triage/search/incident/intake call — just
// the decisive routing facts, kept tight because it's paid for per ticket
// (~400 tokens vs ~2,000 for the expanded profile). Triage escalates to the
// expanded profile only when routing confidence lands below the auto-apply
// gate; suggest-fix always grounds against the expanded profile.
export const DEFAULT_CORE_ENVIRONMENT_PROFILE = `Master Electronics quick reference (electronic components distributor; Phoenix AZ = HQ + main distribution center, warehouses in Germantown WI and Toronto, sales offices across North America; much of the warehouse workforce writes in Spanish; a ticket's site appears as a location tag like phoenix-az):
- MERP is the in-house ERP; OMS is its web version used by most warehouse
  users — OMS, order-entry, and EDI issues are MERP tickets, not generic web
  problems. MERP down or order flow blocked is business-stopping.
- ZScaler is the company VPN / secure-access client → Network & VPN.
- Proofpoint is the email-filtering platform — quarantined/blocked mail,
  inbound AND outbound → Security, not Email & Collaboration.
- CrowdStrike is the endpoint security (EDR) agent; Keeper is the password
  manager → Security. Phishing often imitates DocuSign; CLICKED or entered
  credentials = P1–P2 incident, merely received = normal report.
- Microsoft Entra ID sign-in: password resets, lockouts, MFA prompts →
  Access & Accounts unless an actual incident is described.
- AutoStore is the robotic storage grid in the Phoenix DC; faults stall
  picking → Warehouse Tech, high impact.
- Zebra printers print shipping/product labels at pack stations → Printing
  & Labels; label printing down near the carrier cutoff is urgent.
- RF scanners and warehouse Wi-Fi → Warehouse Tech. UPS WorldShip / FedEx
  Ship Manager rating or manifest errors block shipping → Warehouse Operations.
- The TMP drive (mapped as M:) is the shared network drive; known registry
  fix in the KB.
- Databricks is the data platform (access requests get guided intake);
  Power BI → Data & Reporting. CRM and quoting tools → Business
  Applications. UKG (payroll) → People Operations. Concur (expenses) →
  Finance & Accounting.
- AMAT is the Applied Materials key-account program — anything threatening
  AMAT orders or forecasts is high business impact.
- ChatGPT / Claude access and automation → AI & Enablement. NinjaOne is the
  endpoint-management agent; TungstenPDF is the standard PDF editor.
- Same-day shipping cutoffs are in the afternoon; month-end close and
  new-hire start dates are hard deadlines.`;

// Live copies — swapped at boot (and on admin save) by services/ai/environment.ts.
let environmentProfile = DEFAULT_ENVIRONMENT_PROFILE;
export function setEnvironmentProfile(text: string) { environmentProfile = text; }
export function getEnvironmentProfile() { return environmentProfile; }
let coreEnvironmentProfile = DEFAULT_CORE_ENVIRONMENT_PROFILE;
export function setCoreEnvironmentProfile(text: string) { coreEnvironmentProfile = text; }
export function getCoreEnvironmentProfile() { return coreEnvironmentProfile; }

export const TriageSchema = z.object({
  category: z.string().describe('Exact name of the best-fitting category from the list'),
  queueSlug: z.string().describe('Slug of the queue that should own this ticket'),
  priority: z.number().int().describe('1 (critical) to 4 (low), per the rubric'),
  sentiment: z.enum(['neutral', 'frustrated', 'urgent']),
  summary: z.string().describe('One or two sentences summarizing the issue for an agent'),
  reasoning: z.string().describe('One short sentence for the reviewing agent: WHY this category/queue/priority — cite the decisive signal (a phrase in the ticket, an error code in a screenshot, company terminology, a correction pattern, the stated business impact)'),
  signals: z.array(z.string()).describe("2-5 observations, in the order you noticed them, that led to the routing — SOTO showing its work. Each one short (max ~90 chars) and citing CONCRETE evidence: a quoted phrase, an error code or app name read from a screenshot, a company-terminology fact that applies, the requester's department/site, a correction pattern that matched, the stated business impact. Never restate the verdict — these are the clues, not the conclusion"),
  subjectIsVague: z.boolean().describe("true when the requester's subject is missing, generic ('help', 'problem', 'this error again'), or an agent scanning the queue couldn't tell what the ticket is about from it alone"),
  suggestedSubject: z.string().describe('A concise, specific subject line, max ~70 chars: the system plus the symptom (e.g. "Zebra ZT411 printing labels half an inch offset"). Always provided; only applied when the original is vague'),
  language: z.string().describe("ISO 639-1 code of the language the ticket is written in ('en', 'es', …). The dominant language when mixed"),
  translation: z.object({
    subject: z.string(),
    description: z.string(),
  }).nullable().describe('Faithful English translation of the subject and description when language is not English; null for English tickets. Translate, never summarize'),
  onBehalfOf: z.string().nullable().describe('EXACT directory name of the person this ticket is actually for, when the text clearly says the submitter is filing for someone else; null otherwise'),
  confidence: z.object({
    category: z.number().describe('0-1'),
    queue: z.number().describe('0-1'),
    priority: z.number().describe('0-1'),
    onBehalfOf: z.number().describe('0-1; 0 when onBehalfOf is null'),
  }),
});
export type TriageResult = z.infer<typeof TriageSchema>;

export type TriageInput = {
  subject: string;
  description: string;
  requesterName: string;
  requesterDepartment: string | null;
  requesterIsVip: boolean;
  source: string;
  statedPriority: number;
  /** Screenshot attachments, base64 — the model reads error dialogs the requester didn't describe. */
  images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }[];
};

export type TriageCorrection = {
  subject: string;
  aiChose: string;
  agentCorrectedTo: string;
};

export type TriageContext = {
  categories: { name: string; description: string | null; queueSlug: string }[];
  queues: { slug: string; name: string; description: string | null }[];
  /** On-behalf-of candidates: directory entries matching the ticket text (pre-filtered, capped). */
  directory: { name: string; department: string | null; location: string | null }[];
  /** Recent agent corrections — injected as patterns to follow. */
  corrections: TriageCorrection[];
  /**
   * Which environment profile rides in the prompt. 'core' (default) is the
   * tight quick-reference every ticket pays for; 'expanded' is the full
   * company knowledge, used when the core pass lands under the confidence gate.
   */
  profileTier?: 'core' | 'expanded';
  /** Include show-its-work signals (demo polish — costs extra output tokens). Default true. */
  showWork?: boolean;
};

export type TriageOutcome = {
  result: TriageResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache split of inputTokens — reads bill at ~0.1x, writes at a premium. */
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type DraftInput = {
  subject: string;
  description: string;
  requesterName: string;
  thread: { author: string; visibility: string; body: string }[];
  articles: { title: string; content: string }[];
};

export type DraftOutcome = {
  draft: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export const IncidentSchema = z.object({
  isIncident: z.boolean().describe('true only if these tickets are symptoms of ONE underlying outage or incident'),
  title: z.string().describe('Short incident title, e.g. "Zoom outage — company-wide"'),
  summary: z.string().describe('2-3 sentences for responders: what is failing, who is affected, common symptoms'),
  confidence: z.number().describe('0-1, honest certainty that this is a single incident'),
});
export type IncidentResult = z.infer<typeof IncidentSchema>;

export type IncidentInput = {
  tickets: { number: string; subject: string; description: string }[];
};

export type IncidentOutcome = {
  result: IncidentResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export const ArticleSchema = z.object({
  worthArticle: z.boolean().describe('true only if this resolution is a repeatable procedure other people will hit, and no existing title already covers it'),
  title: z.string().describe('KB-style how-to title, e.g. "Fix Zebra labels printing offset"'),
  bodyMarkdown: z.string().describe('The article: Symptoms, Cause, Fix (numbered steps). Written for the affected user or a junior agent. Only facts from the ticket — never invent steps.'),
  reason: z.string().describe('One sentence: why this is or is not worth an article'),
  confidence: z.number().describe('0-1'),
});
export type ArticleResult = z.infer<typeof ArticleSchema>;

export type ArticleInput = {
  subject: string;
  description: string;
  categoryName: string;
  thread: { author: string; visibility: string; body: string }[];
  existingTitles: string[];
  /** An agent explicitly asked for this draft — always write one. */
  requested?: boolean;
};

export type ArticleOutcome = {
  result: ArticleResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export const SearchFilterSchema = z.object({
  interpretation: z.string().describe('Short human echo of what will be filtered, e.g. "open Printing & Labels tickets tagged phoenix-az, older than 7 days"'),
  queueSlug: z.string().nullable().describe('Exact queue slug from the list, or null'),
  categoryName: z.string().nullable().describe('Exact category name from the list, or null'),
  tags: z.array(z.string()).describe('Exact tags from the list; locations are slugs like phoenix-az. Places in the query map to location tags. Do NOT add topic tags when a category already captures the topic.'),
  status: z.enum(['open', 'closed', 'any']).describe("open unless the query asks for closed/resolved/all — or references a past time frame ('last month', 'in June', 'a few weeks ago'), which implies searching closed tickets too: use 'any'"),
  requesterName: z.string().nullable().describe("The person who FILED the ticket, when the query says so — possessives ('eric's ticket') or 'from Maria'. First or full name exactly as written; null when the query doesn't name a requester"),
  unassignedOnly: z.boolean(),
  priorityAtMost: z.number().nullable().describe('1-4 when the query names a priority or says critical/high; P2-or-higher means 2'),
  olderThanDays: z.number().nullable(),
  newerThanDays: z.number().nullable(),
  textSearch: z.string().nullable().describe('Residual free-text to substring-match the subject, ONLY when no category/queue captures it'),
  confidence: z.number().describe('0-1'),
});
export type SearchFilterResult = z.infer<typeof SearchFilterSchema>;

export type SearchParseContext = {
  queues: { slug: string; name: string }[];
  categories: string[];
  tags: string[];
};

export type SearchParseOutcome = {
  result: SearchFilterResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Guided intake (today: Databricks access). Every answer is nullable —
// null means "the text doesn't say", which is what SOTO then asks about.
export const IntakeSchema = z.object({
  answers: z.object({
    isAccessIssue: z.boolean().nullable().describe('Is this an access issue (vs a different kind of problem)? null if the text does not say'),
    accessedBefore: z.boolean().nullable().describe('Have they successfully accessed this resource before? null if unknown'),
    newlyIntroduced: z.boolean().nullable().describe('Is the resource something new that was recently introduced to them? null if unknown'),
    instructedToUse: z.boolean().nullable().describe('Did someone (lead, manager) instruct them to start using a new table/dataset/process? null if unknown'),
    firstAttempt: z.boolean().nullable().describe('Is this their first attempt at accessing it? null if unknown'),
  }),
  resources: z.array(z.string()).describe('Tables, datasets, schemas, or reports the requester names, exactly as written; empty if none named'),
  verdict: z.enum(['new_access', 'broken_access', 'not_access', 'unclear']),
  reasoning: z.string().describe('One sentence: the decisive signal for the verdict'),
  confidence: z.number().describe('0-1 certainty in the verdict'),
});
export type IntakeResult = z.infer<typeof IntakeSchema>;

export type IntakeInput = {
  subject: string;
  description: string;
  requesterName: string;
  /** Public conversation so far — SOTO's questions and the requester's replies. */
  thread: { author: string; body: string }[];
};

export type IntakeOutcome = {
  result: IntakeResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// KB deflection: does this article actually solve THIS ticket, and if so,
// what's the self-service reply? The AI is the precision gate — a wrong
// suggestion erodes trust faster than no suggestion.
export const DeflectSchema = z.object({
  canDeflect: z.boolean().describe('true ONLY if following the article would plausibly resolve this exact ticket without an agent; false for hardware swaps, permission grants, anything needing admin action, or a weak topical match'),
  reply: z.string().describe('When canDeflect: the self-service fix for the requester — 2-6 short numbered steps distilled from the article and adapted to their situation, no preamble or signoff. Empty string otherwise'),
  confidence: z.number().describe('0-1'),
});
export type DeflectResult = z.infer<typeof DeflectSchema>;

export type DeflectInput = {
  subject: string;
  description: string;
  article: { title: string; body: string };
};

export type DeflectOutcome = {
  result: DeflectResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Similar-ticket grounding: the agent opens a ticket and SOTO proposes a
// fix drawn from what actually resolved the lookalike tickets — the
// institutional memory that used to live in a senior agent's head.
export const ResolutionSchema = z.object({
  hasSuggestion: z.boolean().describe('true only when at least one past resolution (or KB excerpt) genuinely addresses THIS ticket — a topical rhyme is not enough'),
  suggestionMarkdown: z.string().describe("The proposed fix for the working agent: one orienting sentence, then 2-6 numbered steps drawn ONLY from the provided resolutions and KB excerpts, adapted to this ticket's specifics. Empty string when hasSuggestion is false"),
  basedOn: z.array(z.string()).describe('Ticket numbers (e.g. T-1000042) of the past resolutions the suggestion actually draws from, most relevant first; empty when none were used'),
  caveat: z.string().describe("One short sentence on what to verify before applying, or when this fix wouldn't apply; empty string if nothing to flag"),
  confidence: z.number().describe('0-1 honest certainty that this suggestion resolves the ticket'),
});
export type ResolutionResult = z.infer<typeof ResolutionSchema>;

export type ResolutionInput = {
  subject: string;
  description: string;
  similar: { number: string; subject: string; resolvedAgo: string; resolution: string }[];
  articles: { title: string; excerpt: string }[];
};

export type ResolutionOutcome = {
  result: ResolutionResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Weekly digest: deterministic aggregation happens in code; the AI turns
// the facts into a briefing a queue lead would actually read.
export const DigestSchema = z.object({
  headline: z.string().describe('One sentence: the single most important thing in this period, specific ("Docking-station failures tripled" not "ticket volume changed")'),
  findings: z.array(z.object({
    kind: z.enum(['problem', 'trend', 'kb_gap', 'ops']).describe('problem = recurring issue worth root-causing; trend = volume shift; kb_gap = repeated issue with no article; ops = SLA/CSAT/staffing signal'),
    title: z.string().describe('Short, specific, max ~60 chars'),
    detail: z.string().describe('1-2 sentences citing the numbers provided — never invent figures'),
    suggestedAction: z.string().describe('One concrete next step ("replace the side-entrance reader panel", "draft a KB article from T-1000432")'),
  })).describe('3-6 findings, most important first. Only findings the data actually supports'),
});
export type DigestResult = z.infer<typeof DigestSchema>;

export type DigestInput = {
  periodDays: number;
  clusters: { category: string; token: string; count: number; distinctDays: number; sampleSubjects: string[]; kbGap: boolean }[];
  categoryTrends: { category: string; recent: number; prior: number }[];
  slaByQueue: { queue: string; breached: number; total: number }[];
  csatLow: { queue: string; avg: number; count: number }[];
};

export type DigestOutcome = {
  result: DigestResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

// Reply translation: agent writes English, the requester reads their own
// language (the inbound direction rides the triage call).
export const TranslateSchema = z.object({
  translation: z.string().describe('The text translated faithfully into the target language. Technical terms, error codes, and ticket numbers stay verbatim'),
});
export type TranslateInput = { text: string; targetLanguage: string };
export type TranslateOutcome = {
  result: z.infer<typeof TranslateSchema>;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AIProvider {
  triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome>;
  draftReply(input: DraftInput): Promise<DraftOutcome>;
  assessIncident(input: IncidentInput): Promise<IncidentOutcome>;
  draftArticle(input: ArticleInput): Promise<ArticleOutcome>;
  parseSearch(query: string, ctx: SearchParseContext): Promise<SearchParseOutcome>;
  parseIntake(input: IntakeInput): Promise<IntakeOutcome>;
  suggestFix(input: DeflectInput): Promise<DeflectOutcome>;
  suggestResolution(input: ResolutionInput): Promise<ResolutionOutcome>;
  writeDigest(input: DigestInput): Promise<DigestOutcome>;
  translate(input: TranslateInput): Promise<TranslateOutcome>;
}

// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: TriageContext): string {
  const categoryList = ctx.categories
    .map((c) => `- ${c.name} (queue: ${c.queueSlug}): ${c.description ?? ''}`)
    .join('\n');
  const queueList = ctx.queues
    .map((q) => `- ${q.slug}: ${q.name} — ${q.description ?? ''}`)
    .join('\n');

  return `You triage IT helpdesk tickets for Master Electronics, an electronic
components distributor (Phoenix HQ, warehouse, branch offices). Classify each
ticket into exactly one category, recommend the owning queue, and assess
priority.

Categories (use the exact name):
${categoryList}

Queues (use the exact slug):
${queueList}

${ctx.profileTier === 'expanded' ? environmentProfile : coreEnvironmentProfile}

Priority rubric — judge by BUSINESS IMPACT described in the ticket text, not
by how urgent the requester sounds; requesters routinely over- and under-state
priority:
- 1: Business-stopping. Many users blocked, order flow / shipping / EDI down,
  security incident with confirmed exposure (clicked phish, credentials entered).
- 2: Significant. A team degraded, a key process failing, single VIP fully
  blocked, time-sensitive deadline at risk, reported phishing campaign.
- 3: Normal. One person impaired but able to work, standard requests with
  normal lead time.
- 4: Low. Cosmetic issues, convenience requests, nice-to-haves, no deadline.

On-behalf-of detection: sometimes the submitter is filing for ANOTHER person
("filing this for our VP", "Hannah at the warehouse needs…", "my new hire
can't log in"). Each ticket lists its possible beneficiaries — the directory
entries whose names appear in the ticket text. When the text clearly
identifies one of them as the actual beneficiary, set onBehalfOf to their
EXACT listed name. Rules: never the submitter themself; a person merely
mentioned (cc'd, quoted, their manager) is NOT the beneficiary; if the name
is ambiguous (two candidates match) or the list is empty, use null. Most
tickets are for the submitter — null is the common answer.

Confidence values: report your honest certainty per field, 0 to 1. Use lower
values when the ticket is vague, spans multiple categories, or the priority
depends on facts not stated. Do not inflate confidence.

Screenshots: tickets may include screenshot attachments. Read them — error
dialogs, application names, and error codes visible in the image often
identify the category and severity better than the requester's words
("getting this error, help" plus a ZScaler error dialog is a
Network & VPN ticket). When an image informed your classification, quote
the decisive detail (app name, error code) in the summary.

The summary is for the agent picking up the ticket: what is broken/needed,
who is affected, and any deadline — one or two sentences, no preamble.

The reasoning is for the agent REVIEWING your routing: one short sentence
naming the decisive signal — quote the phrase, error code, or terminology
that settled it ('OMS is the web front-end for MERP', 'Error 5003 is a
Zoom connectivity code', 'matches the recent correction pattern for
docking stations'). Not a restatement of the answer; say what tipped it.

${ctx.showWork === false
    ? `Signals: the transparency display is switched off — return signals as
an empty array.`
    : `The signals show your work to the person watching the routing land: 2-5
short observations in the order you noticed them, each citing concrete
evidence — a quoted phrase from the ticket, an error code or application
name read off a screenshot, the company-terminology fact that applies
('OMS is the web version of MERP'), the requester's department or site
when it mattered, a correction pattern that matched, the business impact
that set priority. Clues only, never the conclusion — the verdict has its
own fields.`}

Subject line: requesters often leave the subject blank or write something
useless ('help', 'question', 'this again'). Mark subjectIsVague true only
when an agent scanning the queue couldn't tell what the ticket is about
from the subject alone — a decent subject stays untouched. Always provide
suggestedSubject: concise and specific, the system plus the symptom, drawn
from the description (and screenshots), max ~70 characters. Write it in
the ticket's own language.

Language: much of the warehouse workforce writes in Spanish. Report the
ticket's language, and when it isn't English, provide a faithful English
translation of the subject and description (translate everything —
error messages, part numbers, and names stay verbatim). Classify and
summarize from the MEANING regardless of language; the summary and
reasoning are always in English for the agents.`;
}

// Sonnet 5 runs ADAPTIVE thinking when the `thinking` param is omitted —
// for these single-shot structured classifications we want the fast, cheap
// path, so disable it explicitly on models that default thinking-on.
// (Opus 4.8 and Haiku 4.5 already run without thinking when omitted.)
function thinkingOff(model: string) {
  return model.startsWith('claude-sonnet-5')
    ? { thinking: { type: 'disabled' as const } }
    : {};
}

class ClaudeProvider implements AIProvider {
  private client = new Anthropic({ apiKey: env.anthropicApiKey });

  async triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome> {
    // Model tiering mirrors the profile tiering: the core pass runs on the
    // mid-tier model; the low-confidence escalation re-runs on the
    // heavyweight with the expanded profile.
    const model = ctx.profileTier === 'expanded' ? env.aiModel : env.aiModelTriage;
    const response = await this.client.messages.parse({
      model,
      max_tokens: 2000,
      ...thinkingOff(model),
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(ctx),
          // Static across tickets. The core pass uses the 1h TTL so the
          // prefix survives gaps between tickets; the rare escalation pass
          // keeps the default 5m (a 1h write costs 2x and would rarely be
          // read at escalation volume).
          cache_control: ctx.profileTier === 'expanded'
            ? { type: 'ephemeral' }
            : { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages: [
        {
          role: 'user',
          // Corrections and beneficiary candidates ride in the user turn (not
          // the system block) so the cached static prompt prefix survives
          // new feedback and per-ticket variation. Screenshots become image
          // blocks ahead of the text.
          content: [
            ...(input.images ?? []).map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
            })),
            {
              type: 'text' as const,
              text: `${ctx.corrections.length ? `Agents recently corrected these AI classifications — follow these patterns when similar tickets appear:
${ctx.corrections.map((c) => `- "${c.subject}": AI chose ${c.aiChose}; agents corrected to ${c.agentCorrectedTo}`).join('\n')}

` : ''}${ctx.directory.length ? `Possible beneficiaries (directory entries whose names appear in this ticket):
${ctx.directory.map((u) => `- ${u.name} (${u.department ?? '—'}, ${u.location ?? '—'})`).join('\n')}

` : ''}Triage this ticket${input.images?.length ? ` (${input.images.length} screenshot${input.images.length > 1 ? 's' : ''} attached above)` : ''}:
Subject: ${input.subject}
Submitted by: ${input.requesterName} (${input.requesterDepartment ?? 'unknown'}${input.requesterIsVip ? ', VIP/executive' : ''})
Source: ${input.source}
Requester-stated priority: P${input.statedPriority}
Description:
${input.description.slice(0, 4000)}`,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(TriageSchema) },
    });

    if (!response.parsed_output) {
      throw new Error(`triage parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  }

  async draftReply(input: DraftInput): Promise<DraftOutcome> {
    const articles = input.articles.length
      ? input.articles.map((a, i) => `[${i + 1}] ${a.title}\n${a.content}`).join('\n\n')
      : '(none found)';
    const thread = input.thread
      .map((c) => `${c.author}${c.visibility === 'internal' ? ' (internal note)' : ''}: ${c.body}`)
      .join('\n---\n');

    const response = await this.client.messages.create({
      model: env.aiModel,
      max_tokens: 1200,
      system: `You draft helpdesk replies for Master Electronics IT agents. The
agent reviews and edits before sending — write the reply body only, no
subject line, no signature block.

Rules:
- Ground the reply in the knowledge-base excerpts when relevant, and name the
  article you drew from ("per the guide 'How to connect to the VPN'…").
- If no excerpt is relevant, say what you'd try next in plain terms — do NOT
  invent procedures, systems, or policies.
- Address the requester by first name. Plain, direct, friendly; no filler.
- If the thread shows the issue is already solved, draft a confirmation/close
  message instead.`,
      messages: [
        {
          role: 'user',
          content: `Ticket: ${input.subject}
Requester: ${input.requesterName}
Description: ${input.description.slice(0, 2000)}

Thread so far:
${thread || '(no replies yet)'}

Knowledge-base excerpts:
${articles}

Draft the reply.`,
        },
      ],
    });

    const draft = response.content
      .filter((b): b is Extract<typeof response.content[number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return {
      draft,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async assessIncident(input: IncidentInput): Promise<IncidentOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModelLight, // confirms a heuristic-detected cluster — light tier
      max_tokens: 1000,
      ...thinkingOff(env.aiModelLight),
      system: `You watch an IT helpdesk intake stream for Master Electronics.
Given a burst of recently created tickets that look textually similar, decide
whether they are symptoms of ONE underlying incident (an outage, a broken
service, a failed change) or merely coincidental lookalikes (e.g. several
unrelated password resets). Judge by whether one root cause plausibly explains
all of them. Be conservative: separate people with separate problems is NOT an
incident, even if the subjects rhyme.

${coreEnvironmentProfile}`,
      messages: [
        {
          role: 'user',
          content: `These ${input.tickets.length} tickets arrived within a short window:

${input.tickets.map((t) => `${t.number} — ${t.subject}\n${t.description.slice(0, 400)}`).join('\n\n')}

One incident, or coincidence?`,
        },
      ],
      output_config: { format: zodOutputFormat(IncidentSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`incident assessment parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async draftArticle(input: ArticleInput): Promise<ArticleOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModel,
      max_tokens: 2500,
      system: `You maintain the IT knowledge base for Master Electronics. When a
ticket resolves, you decide whether the resolution is worth a KB article and,
if so, draft it.

Worth an article: a repeatable procedure or fix that other employees or
agents will plausibly need — configuration steps, a workaround, a gotcha.
NOT worth one: one-off hardware swaps, account-specific changes, anything an
existing article already covers (titles provided), or resolutions where the
thread never actually says what fixed it. Be conservative — a bad article is
worse than none.

When drafting: use only facts stated in the ticket thread. Structure as
Symptoms / Cause / Fix with numbered steps. Write for the affected user (or a
junior agent for admin-side steps). No invented menu paths, no guessed
settings.`,
      messages: [
        {
          role: 'user',
          content: `Resolved ticket in category "${input.categoryName}":
Subject: ${input.subject}
Description: ${input.description.slice(0, 1500)}

Resolution thread:
${input.thread.map((c) => `${c.author}${c.visibility === 'internal' ? ' (internal)' : ''}: ${c.body.slice(0, 600)}`).join('\n---\n')}

Existing article titles (do not duplicate):
${input.existingTitles.map((t) => `- ${t}`).join('\n')}

${input.requested
  ? `An agent read this ticket and explicitly asked for a KB draft, so their
judgment overrides the worth-an-article test: ALWAYS write the article —
title and full bodyMarkdown — even if the thread is thin. Work from what is
stated (the description alone if need be), generalize the specific case into
a reusable procedure, and put any caveats about missing detail in the article
body itself. Set worthArticle to your honest opinion; the draft is written
either way.`
  : 'Worth an article?'}`,
        },
      ],
      output_config: { format: zodOutputFormat(ArticleSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`article draft parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async parseSearch(query: string, ctx: SearchParseContext): Promise<SearchParseOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModelLight, // simple structured mapping — light tier
      max_tokens: 800,
      ...thinkingOff(env.aiModelLight),
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You translate plain-English helpdesk queue searches into structured
filters. Map to the EXACT names below; anything you can't map goes to
textSearch (or null). Time phrases: "older than a week" = olderThanDays 7,
"this week"/"last 7 days" = newerThanDays 7, "today" = newerThanDays 1.
Don't invent filters the query doesn't ask for. Topics ("printer",
"password") belong in categoryName — use tags only for places (location
slugs) or when the query literally says "tagged X".

Ignore filler ("find", "show me", "ticket(s)") — it is never textSearch.
Possessives and "from <name>" name the REQUESTER — put the name in
requesterName, never in textSearch. A past time frame ("last month",
"back in June") implies the ticket may already be closed: status 'any'
unless the query says otherwise.

${coreEnvironmentProfile}

Queues (slug: name):
${ctx.queues.map((q) => `- ${q.slug}: ${q.name}`).join('\n')}

Categories:
${ctx.categories.map((c) => `- ${c}`).join('\n')}

Tags (locations are slugs):
${ctx.tags.map((t) => `- ${t}`).join('\n')}`,
      }],
      messages: [{ role: 'user', content: `Search: ${query.slice(0, 300)}` }],
      output_config: { format: zodOutputFormat(SearchFilterSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`search parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async parseIntake(input: IntakeInput): Promise<IntakeOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModel,
      max_tokens: 1000,
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You run intake for Databricks access tickets at Master Electronics.
The old flow relayed these through the Service Desk to collect details before
the Data Team could act; your job is to answer the intake questions directly
from what the requester wrote so nobody has to ask twice.

From the ticket text and any Q&A thread, determine:
1. Is this an access issue, or a different kind of problem?
2. Have they successfully accessed the resource before?
3. Is the resource something new that was recently introduced to them?
4. Did someone instruct them to start using a new table, dataset, or process?
   (A lead saying "start using this table" makes it a NEW access request,
   not broken access.)
5. Is this their first attempt at accessing it?

Answer a question ONLY when the text actually says — null otherwise; never
guess. Extract resource names (tables, datasets, schemas, reports) exactly as
written, only when actually named.

Verdict:
- new_access: they never had it — newly introduced, told to start using it,
  or a first attempt. The Data Team grants permissions.
- broken_access: it worked before and now fails. The Service Desk
  investigates an incident.
- not_access: the problem isn't about access at all.
- unclear: the text doesn't support any of the above.

${coreEnvironmentProfile}`,
      }],
      messages: [{
        role: 'user',
        content: `Ticket from ${input.requesterName}:
Subject: ${input.subject}
Description:
${input.description.slice(0, 3000)}${input.thread.length ? `

Conversation so far:
${input.thread.map((m) => `${m.author}: ${m.body.slice(0, 1000)}`).join('\n---\n')}` : ''}`,
      }],
      output_config: { format: zodOutputFormat(IntakeSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`intake parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async suggestFix(input: DeflectInput): Promise<DeflectOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModelLight, // yes/no gate + steps distilled from one article — light tier
      max_tokens: 1200,
      ...thinkingOff(env.aiModelLight),
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You are the self-service gate for the Master Electronics helpdesk.
A new ticket matched a knowledge-base article. Decide whether the requester
can genuinely fix this THEMSELVES by following the article — and if so,
write the fix as 2-6 short numbered steps adapted to their exact situation
(their app, their error, their words — not a generic paste of the article).

Say canDeflect=false when: the fix needs an agent or admin (permission
grants, hardware swaps, server-side changes), the article is only
topically related, the ticket describes something the article doesn't
cover, or you'd be guessing. A wrong suggestion wastes the requester's
time and erodes trust — be conservative.`,
      }],
      messages: [{
        role: 'user',
        content: `Ticket:
Subject: ${input.subject}
Description:
${input.description.slice(0, 3000)}

Matched KB article — "${input.article.title}":
${input.article.body.slice(0, 4000)}

Can they self-serve this?`,
      }],
      output_config: { format: zodOutputFormat(DeflectSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`deflection parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async suggestResolution(input: ResolutionInput): Promise<ResolutionOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModel,
      max_tokens: 1500,
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You suggest fixes to Master Electronics helpdesk agents from
institutional memory: past resolved tickets similar to the one being
worked, plus matching knowledge-base excerpts. Your suggestion appears
beside the ticket; the agent decides what to do with it.

Ground every step in what actually resolved a provided ticket or what a
provided KB excerpt says — never invent procedures, menu paths, or
settings. List the ticket numbers you actually drew from in basedOn, and
adapt the steps to THIS ticket's specifics (their application, their
error, their site). Admin-side steps are fine — the reader is an agent
with admin tools, not the requester.

Say hasSuggestion=false rather than guessing when the past resolutions
don't genuinely address this ticket: a different root cause, threads that
never say what fixed it, or only a topical rhyme. A wrong suggestion
erodes trust faster than no suggestion.

${environmentProfile}`,
      }],
      messages: [{
        role: 'user',
        content: `Ticket being worked:
Subject: ${input.subject}
Description:
${input.description.slice(0, 2500)}

Similar resolved tickets (institutional memory):
${input.similar.map((s) => `${s.number} — ${s.subject} (resolved ${s.resolvedAgo})
${s.resolution}`).join('\n\n') || '(none found)'}

Knowledge-base excerpts:
${input.articles.map((a) => `"${a.title}"\n${a.excerpt}`).join('\n\n') || '(none found)'}

Suggest a fix, or decline.`,
      }],
      output_config: { format: zodOutputFormat(ResolutionSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`resolution suggestion parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async writeDigest(input: DigestInput): Promise<DigestOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModel,
      max_tokens: 1500,
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You write the weekly operations briefing for the Master Electronics
helpdesk — the thing a queue lead reads Monday morning to know where the
fires are before they're fires.

You are given pre-computed facts: recurring-issue clusters (the same
kind of ticket appearing across multiple days — candidate PROBLEMS worth
root-causing rather than fixing one ticket at a time), category volume
trends, SLA breach rates by queue, low CSAT pockets, and which clusters
have NO matching knowledge-base article (kb_gap — repeated issues nobody
has documented; suggest drafting from a recent resolved example).

Rules: cite only the numbers given, never invent figures or ticket
numbers. Prefer the finding that saves the most future tickets. A
cluster spanning several days is a problem pattern; one busy day is not.
Plain language, no filler.`,
      }],
      messages: [{
        role: 'user',
        content: `Period: last ${input.periodDays} days.

Recurring clusters (category · signal word · count · distinct days · KB gap?):
${input.clusters.map((c) => `- ${c.category} · "${c.token}" · ${c.count} tickets over ${c.distinctDays} days${c.kbGap ? ' · NO KB ARTICLE' : ''}
  e.g. ${c.sampleSubjects.slice(0, 3).join(' | ')}`).join('\n') || '- none detected'}

Category volume (recent half vs prior half of period):
${input.categoryTrends.map((t) => `- ${t.category}: ${t.prior} → ${t.recent}`).join('\n') || '- flat'}

Resolution SLA by queue (breached/total):
${input.slaByQueue.map((s) => `- ${s.queue}: ${s.breached}/${s.total}`).join('\n') || '- none'}

Low CSAT pockets:
${input.csatLow.map((c) => `- ${c.queue}: ${c.avg}★ over ${c.count} ratings`).join('\n') || '- none'}

Write the briefing.`,
      }],
      output_config: { format: zodOutputFormat(DigestSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`digest parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }

  async translate(input: TranslateInput): Promise<TranslateOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModelLight, // faithful translation — light tier handles it well
      max_tokens: 1500,
      ...thinkingOff(env.aiModelLight),
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: `You translate helpdesk replies for Master Electronics. Translate
faithfully into the target language — plain, friendly register. Keep
technical terms, application names, error codes, file paths, URLs, and
ticket numbers (T-1000042) verbatim. Never summarize or add anything.`,
      }],
      messages: [{
        role: 'user',
        content: `Target language: ${input.targetLanguage}\n\nText:\n${input.text.slice(0, 6000)}`,
      }],
      output_config: { format: zodOutputFormat(TranslateSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`translate parse failed (stop_reason: ${response.stop_reason})`);
    }
    return {
      result: response.parsed_output,
      model: response.model,
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }
}

/** Keyword-based mock for offline dev and as a demo fallback. */
class MockProvider implements AIProvider {
  async triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome> {
    const text = `${input.subject} ${input.description}`.toLowerCase();
    const rules: [RegExp, string][] = [
      [/vpn|zscaler|wi-?fi|network|internet|firewall/, 'Network & VPN'],
      [/receiving|shipment|shipping|cycle count|ltl|pallet|value-add/, 'Warehouse Operations'],
      [/payroll|ukg|recruiting|requisition|training/, 'People Operations'],
      [/invoice|credit memo|gl |expense/, 'Finance & Accounting'],
      [/quality|rohs|reach|rma|inspection/, 'Quality'],
      [/pricing|price list|cross-reference|datasheet|catalog/, 'Product & Pricing'],
      [/amat|applied materials/, 'AMAT Program'],
      [/export|customs|carrier|freight|logistics/, 'Supply Chain & Logistics'],
      [/dc connect|dc solutions/, 'DC Solutions'],
      [/quote|order status|sample|c of c/, 'Sales Support'],
      [/scanner|rf |pack station|conveyor/, 'Warehouse Tech'],
      [/merp|\boms\b|edi|price list|erp/, 'MERP'],
      [/\bcrm\b|quote|concur/, 'Business Apps'],
      [/phish|suspicious|mfa|security|clicked/, 'Security'],
      [/crowdstrike|keeper|proofpoint|quarantin|spam/, 'Security'],
      [/password|locked|access|permission|account/, 'Access & Accounts'],
      [/print|label|zebra|toner|laserjet|brother/, 'Printing & Labels'],
      [/report|dashboard|power bi|extract|data/, 'Data & Reporting'],
      [/chatgpt|claude|ai /, 'AI & Enablement'],
      [/ups|fedex|worldship/, 'Warehouse Operations'],
      [/email|outlook|zoom|slack|sharepoint|calendar|mailbox/, 'Email & Collaboration'],
      [/badge|desk|hvac|conference room|office/, 'Facilities'],
      [/phone|voicemail|mobile/, 'Phones & Mobile'],
      [/new hire|onboard|offboard|intern|departure/, 'Onboarding & Offboarding'],
      [/laptop|monitor|dock|keyboard|hardware|device/, 'Hardware'],
    ];
    const hit = rules.find(([re]) => re.test(text));
    const category = ctx.categories.find((c) => c.name === hit?.[1]) ?? ctx.categories[0]!;
    const urgent = /down|all |everyone|blocked|urgent|asap|customer/.test(text);
    // On-behalf: a directory full name (not the submitter's) appearing in
    // a filing-for-someone context.
    const raw = `${input.subject} ${input.description}`;
    const onBehalf = ctx.directory.find((u) =>
      u.name !== input.requesterName
      && raw.includes(u.name)
      && new RegExp(`(for|behalf of|filing.{0,20}for)\\s+(our\\s+\\w+\\s+)?${u.name}|${u.name}[^.]{0,30}(needs|cannot|can't|is unable)`, 'i').test(raw),
    );
    return {
      result: {
        category: category.name,
        queueSlug: category.queueSlug,
        priority: urgent ? 2 : 3,
        sentiment: urgent ? 'urgent' : 'neutral',
        summary: input.description.split(/[.!?]/)[0]?.slice(0, 160) ?? input.subject,
        reasoning: hit
          ? `Matched the ${category.name} keyword pattern ${hit[0]} (mock provider).`
          : 'No keyword pattern matched — defaulted to the first category at low confidence (mock provider).',
        signals: ctx.showWork === false ? [] : [
          hit ? `Keyword pattern ${hit[0]} matched the ticket text` : 'No keyword pattern matched the ticket text',
          ...(input.requesterDepartment ? [`Requester works in ${input.requesterDepartment}`] : []),
          ...(urgent ? ['Impact language present ("down", "everyone", "blocked", …)'] : []),
          ...(input.images?.length ? [`${input.images.length} screenshot(s) attached (mock provider cannot read them)`] : []),
        ],
        subjectIsVague: input.subject.trim().length < 8
          || /^(help|hi|hello|hey|issue|problem|question|urgent|error|broken|not working|it'?s broken)[!.?\s]*$/i.test(input.subject.trim()),
        suggestedSubject: (input.description.split(/[.!?\n]/)[0] ?? input.subject).trim().slice(0, 70),
        language: /\b(el|la|los|las|una?|que|con|para|porque|está|estoy|puedo|impresora|ayuda|necesito)\b/i.test(raw) ? 'es' : 'en',
        translation: null, // the mock can't translate — agents see the original
        onBehalfOf: onBehalf?.name ?? null,
        confidence: {
          category: hit ? 0.85 : 0.35, queue: hit ? 0.85 : 0.35, priority: 0.5,
          onBehalfOf: onBehalf ? 0.85 : 0,
        },
      },
      model: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  }

  async draftReply(input: DraftInput): Promise<DraftOutcome> {
    const first = input.requesterName.split(' ')[0];
    const cite = input.articles[0]?.title;
    return {
      draft: `Hi ${first},\n\nThanks for reporting this. ${cite ? `Per the guide "${cite}", please try the steps there first. ` : ''}I'm looking into it and will follow up shortly.\n`,
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async assessIncident(input: IncidentInput): Promise<IncidentOutcome> {
    // Called only after the heuristic already found a textual cluster —
    // the mock trusts it and titles the incident from the first subject.
    return {
      result: {
        isIncident: true,
        title: input.tickets[0]?.subject.slice(0, 80) ?? 'Suspected incident',
        summary: `${input.tickets.length} similar tickets arrived in a short window.`,
        confidence: 0.7,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async parseSearch(query: string, ctx: SearchParseContext): Promise<SearchParseOutcome> {
    const q = query.toLowerCase();
    const days = q.match(/older than (?:a |an )?(\d+)?\s*(day|week|month)/);
    const mult = days?.[2] === 'week' ? 7 : days?.[2] === 'month' ? 30 : 1;
    const tag = ctx.tags.find((t) => q.includes(t.replace(/-/g, ' ')) || q.includes(t));
    const category = ctx.categories.find((c) => q.includes(c.toLowerCase()))
      ?? (q.match(/print|label/) ? 'Printing & Labels' : q.match(/password|locked/) ? 'Access & Accounts' : null);
    return {
      result: {
        interpretation: `mock parse of "${query.slice(0, 60)}"`,
        queueSlug: ctx.queues.find((x) => q.includes(x.name.toLowerCase()))?.slug ?? null,
        categoryName: category,
        tags: tag ? [tag] : [],
        status: q.includes('closed') || q.includes('resolved') ? 'closed' : 'open',
        requesterName: q.match(/(\w+)'s\b/)?.[1] ?? null,
        unassignedOnly: q.includes('unassigned'),
        priorityAtMost: q.match(/\bp1\b|critical/) ? 1 : q.match(/\bp2\b|high/) ? 2 : null,
        olderThanDays: days ? (Number(days[1] ?? 1)) * mult : null,
        newerThanDays: null,
        textSearch: null,
        confidence: 0.5,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async draftArticle(input: ArticleInput): Promise<ArticleOutcome> {
    const substantive = input.thread.filter((c) => c.body.length > 60);
    return {
      result: {
        worthArticle: substantive.length >= 2,
        title: `How to resolve: ${input.subject.slice(0, 70)}`,
        bodyMarkdown: `## Symptoms\n${input.description.slice(0, 300)}\n\n## Fix\n${substantive.map((c, i) => `${i + 1}. ${c.body.slice(0, 200)}`).join('\n')}`,
        reason: 'Mock heuristic: multi-step resolution thread.',
        confidence: 0.65,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async suggestFix(input: DeflectInput): Promise<DeflectOutcome> {
    // Mock gate: enough word overlap between ticket and article title.
    const ticketWords = new Set(`${input.subject} ${input.description}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const titleWords = input.article.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const overlap = titleWords.filter((w) => ticketWords.has(w)).length;
    const canDeflect = overlap >= 2;
    return {
      result: {
        canDeflect,
        reply: canDeflect
          ? input.article.body.split('\n').filter(Boolean).slice(0, 4).map((l, i) => `${i + 1}. ${l.slice(0, 160)}`).join('\n')
          : '',
        confidence: canDeflect ? 0.72 : 0.3,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async suggestResolution(input: ResolutionInput): Promise<ResolutionOutcome> {
    // Mock gate: enough word overlap between this ticket and a past one.
    const ticketWords = new Set(`${input.subject} ${input.description}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const best = input.similar
      .map((s) => ({ s, overlap: s.subject.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && ticketWords.has(w)).length }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    const hasSuggestion = !!best && best.overlap >= 2 && best.s.resolution.length > 40;
    return {
      result: {
        hasSuggestion,
        suggestionMarkdown: hasSuggestion
          ? `${best!.s.number} looks like the same issue. What worked there:\n\n${best!.s.resolution.split('\n').filter(Boolean).slice(0, 4).map((l, i) => `${i + 1}. ${l.slice(0, 160)}`).join('\n')}`
          : '',
        basedOn: hasSuggestion ? [best!.s.number] : [],
        caveat: hasSuggestion ? 'Mock provider — verify against the cited ticket before applying.' : '',
        confidence: hasSuggestion ? 0.6 : 0.2,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async parseIntake(input: IntakeInput): Promise<IntakeOutcome> {
    const text = [input.subject, input.description, ...input.thread.map((m) => m.body)].join(' ').toLowerCase();
    // schema.table-style tokens, e.g. finance.revenue or sales_orders
    const resources = [...new Set(
      (text.match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]+\b/g) ?? []).filter((r) => !r.includes('@')),
    )];
    const newish = /never (had|accessed)|first time|new table|start using|told (me|us) to|asked (me|us) to|recently (introduced|added)/.test(text);
    const broken = /used to work|worked (before|yesterday|last week)|suddenly|stopped working|error|denied/.test(text);
    const verdict = newish && !broken ? 'new_access' as const
      : broken && !newish ? 'broken_access' as const
      : 'unclear' as const;
    return {
      result: {
        answers: {
          isAccessIssue: /access|permission/.test(text) ? true : null,
          accessedBefore: broken ? true : newish ? false : null,
          newlyIntroduced: newish ? true : null,
          instructedToUse: /told (me|us) to|asked (me|us) to|start using/.test(text) ? true : null,
          firstAttempt: /first time/.test(text) ? true : null,
        },
        resources,
        verdict,
        reasoning: `Mock keyword heuristic (${verdict}).`,
        confidence: verdict === 'unclear' ? 0.4 : 0.75,
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async translate(input: TranslateInput): Promise<TranslateOutcome> {
    return {
      result: { translation: `[${input.targetLanguage}] ${input.text}` },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }

  async writeDigest(input: DigestInput): Promise<DigestOutcome> {
    const top = input.clusters[0];
    return {
      result: {
        headline: top
          ? `${top.count} "${top.token}" tickets in ${top.category} over ${top.distinctDays} days`
          : 'No recurring problems detected this period',
        findings: input.clusters.slice(0, 4).map((c) => ({
          kind: (c.kbGap ? 'kb_gap' : 'problem') as 'kb_gap' | 'problem',
          title: `${c.category}: recurring "${c.token}" tickets`,
          detail: `${c.count} similar tickets across ${c.distinctDays} days. e.g. ${c.sampleSubjects[0] ?? ''}`,
          suggestedAction: c.kbGap ? 'Draft a KB article from a resolved example.' : 'Investigate a shared root cause.',
        })),
      },
      model: 'mock', inputTokens: 0, outputTokens: 0,
    };
  }
}

// Runtime AI kill switch: flipped from the admin panel (persisted in
// app_config, loaded at boot by services/ai/environment.ts). When off, every
// AI feature degrades to the keyword-based mock — the helpdesk keeps
// running, no restart, no deploy. Also the honest answer to "what if the
// AI vendor goes away": the entire provider dependency lives in this file
// behind the AIProvider interface.
let aiRuntimeEnabled = true;
export function setAiRuntimeEnabled(enabled: boolean) { aiRuntimeEnabled = enabled; }
export function getAiRuntimeEnabled() { return aiRuntimeEnabled; }

export function getAIProvider(): AIProvider {
  if (aiRuntimeEnabled && env.aiProvider === 'claude' && env.anthropicApiKey) return new ClaudeProvider();
  return new MockProvider();
}
