import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '../../config.js';

export const PROMPT_VERSION = 'triage-v1';

export const TriageSchema = z.object({
  category: z.string().describe('Exact name of the best-fitting category from the list'),
  queueSlug: z.string().describe('Slug of the queue that should own this ticket'),
  priority: z.number().int().describe('1 (critical) to 4 (low), per the rubric'),
  sentiment: z.enum(['neutral', 'frustrated', 'urgent']),
  summary: z.string().describe('One or two sentences summarizing the issue for an agent'),
  confidence: z.object({
    category: z.number().describe('0-1'),
    queue: z.number().describe('0-1'),
    priority: z.number().describe('0-1'),
  }),
});
export type TriageResult = z.infer<typeof TriageSchema>;

export type TriageInput = {
  subject: string;
  description: string;
  requesterDepartment: string | null;
  requesterIsVip: boolean;
  source: string;
  statedPriority: number;
};

export type TriageContext = {
  categories: { name: string; description: string | null; queueSlug: string }[];
  queues: { slug: string; name: string; description: string | null }[];
};

export type TriageOutcome = {
  result: TriageResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AIProvider {
  triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome>;
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

Confidence values: report your honest certainty per field, 0 to 1. Use lower
values when the ticket is vague, spans multiple categories, or the priority
depends on facts not stated. Do not inflate confidence.

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
          content: `Triage this ticket:
Subject: ${input.subject}
Requester department: ${input.requesterDepartment ?? 'unknown'}${input.requesterIsVip ? ' (VIP/executive)' : ''}
Source: ${input.source}
Requester-stated priority: P${input.statedPriority}
Description:
${input.description.slice(0, 4000)}`,
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
}

/** Keyword-based mock for offline dev and as a demo fallback. */
class MockProvider implements AIProvider {
  async triage(input: TriageInput, ctx: TriageContext): Promise<TriageOutcome> {
    const text = `${input.subject} ${input.description}`.toLowerCase();
    const rules: [RegExp, string][] = [
      [/vpn|wi-?fi|network|internet|firewall/, 'Network & VPN'],
      [/scanner|rf |warehouse|pack station|conveyor/, 'Warehouse Tech'],
      [/merp|edi|price list|erp/, 'MERP'],
      [/salesforce|quote|concur/, 'Business Apps'],
      [/phish|suspicious|mfa|security|clicked/, 'Security'],
      [/password|locked|access|permission|account/, 'Access & Accounts'],
      [/print|label|zebra|toner/, 'Printing & Labels'],
      [/report|dashboard|power bi|extract|data/, 'Data & Reporting'],
      [/email|outlook|teams|sharepoint|calendar|mailbox/, 'Email & Collaboration'],
      [/badge|desk|hvac|conference room|office/, 'Facilities'],
      [/phone|voicemail|mobile/, 'Phones & Mobile'],
      [/new hire|onboard|offboard|intern|departure/, 'Onboarding & Offboarding'],
      [/laptop|monitor|dock|keyboard|hardware|device/, 'Hardware'],
    ];
    const hit = rules.find(([re]) => re.test(text));
    const category = ctx.categories.find((c) => c.name === hit?.[1]) ?? ctx.categories[0]!;
    const urgent = /down|all |everyone|blocked|urgent|asap|customer/.test(text);
    return {
      result: {
        category: category.name,
        queueSlug: category.queueSlug,
        priority: urgent ? 2 : 3,
        sentiment: urgent ? 'urgent' : 'neutral',
        summary: input.description.split(/[.!?]/)[0]?.slice(0, 160) ?? input.subject,
        confidence: { category: hit ? 0.85 : 0.35, queue: hit ? 0.85 : 0.35, priority: 0.5 },
      },
      model: 'mock',
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

export function getAIProvider(): AIProvider {
  if (env.aiProvider === 'claude' && env.anthropicApiKey) return new ClaudeProvider();
  return new MockProvider();
}
