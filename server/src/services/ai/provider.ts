import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '../../config.js';

export const PROMPT_VERSION = 'triage-v4'; // v3: screenshot attachments; v4: org glossary (ZScaler, OMS)

// Company-specific terms the model won't know from ticket text alone. Shared
// across the triage, search, and incident prompts so they route consistently.
const ORG_GLOSSARY = `Master Electronics terminology:
- ZScaler is the company VPN / secure-access client. ZScaler problems are
  Network & VPN tickets, not a third-party app issue.
- MERP is the in-house ERP. OMS is the web version of MERP, used by most
  warehouse users — OMS issues are MERP tickets, not a generic web problem.`;

export const TriageSchema = z.object({
  category: z.string().describe('Exact name of the best-fitting category from the list'),
  queueSlug: z.string().describe('Slug of the queue that should own this ticket'),
  priority: z.number().int().describe('1 (critical) to 4 (low), per the rubric'),
  sentiment: z.enum(['neutral', 'frustrated', 'urgent']),
  summary: z.string().describe('One or two sentences summarizing the issue for an agent'),
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
};

export type TriageOutcome = {
  result: TriageResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
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
  status: z.enum(['open', 'closed', 'any']).describe('open unless the query asks for closed/resolved or all/any'),
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

export interface AIProvider {
  triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome>;
  draftReply(input: DraftInput): Promise<DraftOutcome>;
  assessIncident(input: IncidentInput): Promise<IncidentOutcome>;
  draftArticle(input: ArticleInput): Promise<ArticleOutcome>;
  parseSearch(query: string, ctx: SearchParseContext): Promise<SearchParseOutcome>;
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

${ORG_GLOSSARY}

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
who is affected, and any deadline — one or two sentences, no preamble.`;
}

class ClaudeProvider implements AIProvider {
  private client = new Anthropic({ apiKey: env.anthropicApiKey });

  async triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome> {
    const response = await this.client.messages.parse({
      model: env.aiModel,
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(ctx),
          cache_control: { type: 'ephemeral' }, // static across tickets
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
      model: env.aiModel,
      max_tokens: 1000,
      system: `You watch an IT helpdesk intake stream for Master Electronics.
Given a burst of recently created tickets that look textually similar, decide
whether they are symptoms of ONE underlying incident (an outage, a broken
service, a failed change) or merely coincidental lookalikes (e.g. several
unrelated password resets). Judge by whether one root cause plausibly explains
all of them. Be conservative: separate people with separate problems is NOT an
incident, even if the subjects rhyme.

${ORG_GLOSSARY}`,
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

Worth an article?`,
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
      model: env.aiModel,
      max_tokens: 800,
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

${ORG_GLOSSARY}

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
      [/salesforce|quote|concur/, 'Business Apps'],
      [/phish|suspicious|mfa|security|clicked/, 'Security'],
      [/crowdstrike|keeper|quarantin/, 'Security'],
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
        onBehalfOf: onBehalf?.name ?? null,
        confidence: {
          category: hit ? 0.85 : 0.35, queue: hit ? 0.85 : 0.35, priority: 0.5,
          onBehalfOf: onBehalf ? 0.85 : 0,
        },
      },
      model: 'mock',
      inputTokens: 0,
      outputTokens: 0,
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
}

export function getAIProvider(): AIProvider {
  if (env.aiProvider === 'claude' && env.anthropicApiKey) return new ClaudeProvider();
  return new MockProvider();
}
