import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAIProvider, type IntakeResult } from './ai/provider.js';
import { getBotUser } from './templates.js';

const { tickets, ticketComments, ticketEvents, aiUsage, users, teams } = schema;

/**
 * Guided intake: ticket patterns with a known clarify-then-route dance.
 * Today that's Databricks access — the old flow parked these at the Service
 * Desk to collect table names before the Data Team could act. SOTO answers
 * the intake questions from the ticket text, asks only what's missing,
 * parses the reply, and routes — no relay. Add a flow by adding an entry.
 */
const FLOWS = [{
  key: 'databricks-access',
  trigger: /databricks/i,
  /** Where new-access requests go to be granted. */
  grantQueueSlug: 'data-reporting',
  grantQueueLabel: 'Data Team',
  /** Where broken-access incidents go to be investigated. */
  fixQueueSlug: 'it-support',
  fixQueueLabel: 'Service Desk',
}];
type Flow = typeof FLOWS[number];

const CONFIDENT = 0.7;
const MAX_ROUNDS = 2;

/** The intake questions, keyed by the schema field that answers them. */
const QUESTIONS: [keyof IntakeResult['answers'] | 'resources', string][] = [
  ['isAccessIssue', 'Is this an access issue, or are you experiencing a different kind of problem?'],
  ['accessedBefore', 'Have you successfully accessed this before?'],
  ['newlyIntroduced', 'Is this something new that was recently introduced to you?'],
  ['instructedToUse', 'Has someone (a team lead or manager) instructed you to start using a new table, dataset, or process?'],
  ['firstAttempt', 'Is this the first time you are attempting to access it?'],
  ['resources', 'Which specific tables or datasets do you need?'],
];

type IntakeState = {
  flow: string;
  state: 'awaiting' | 'resolved' | 'skipped' | 'needs_human';
  rounds: number;
  verdict?: string;
  resources?: string[];
};

async function getTicket(ticketId: number) {
  const [t] = await db
    .select({
      id: tickets.id, number: tickets.number, subject: tickets.subject,
      description: tickets.description, queueId: tickets.queueId,
      customFields: tickets.customFields, requesterId: tickets.requesterId,
      requesterName: users.name,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.requesterId))
    .where(eq(tickets.id, ticketId));
  return t;
}

async function saveState(ticketId: number, customFields: unknown, intake: IntakeState) {
  await db.update(tickets)
    .set({ customFields: { ...(customFields as object ?? {}), intake }, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));
}

function unanswered(r: IntakeResult): string[] {
  const missing = QUESTIONS
    .filter(([key]) => key === 'resources' ? r.resources.length === 0 : r.answers[key] === null)
    .map(([, q]) => q);
  return missing;
}

/** Verdict is actionable when confident — and new access also needs table names. */
function actionable(r: IntakeResult): boolean {
  if (r.confidence < CONFIDENT) return false;
  if (r.verdict === 'unclear') return false;
  if (r.verdict === 'new_access' && r.resources.length === 0) return false;
  return true;
}

async function runParse(ticketId: number, t: NonNullable<Awaited<ReturnType<typeof getTicket>>>) {
  // Public conversation only — SOTO's questions and the requester's answers
  // (a reply may be as terse as "1. yes 2. no", so no content filtering).
  const thread = await db
    .select({ author: users.name, body: ticketComments.bodyText, visibility: ticketComments.visibility })
    .from(ticketComments)
    .innerJoin(users, eq(users.id, ticketComments.authorId))
    .where(eq(ticketComments.ticketId, ticketId))
    .orderBy(asc(ticketComments.id))
    .then((rows) => rows.filter((c) => c.visibility === 'public').slice(-6)
      .map((c) => ({ author: c.author, body: c.body })));

  const outcome = await getAIProvider().parseIntake({
    subject: t.subject, description: t.description,
    requesterName: t.requesterName, thread,
  });
  await db.insert(aiUsage).values({
    feature: 'intake', model: outcome.model, ticketId,
    inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
  });
  return outcome.result;
}

async function postQuestions(ticketId: number, t: { requesterName: string }, r: IntakeResult, flow: Flow, rounds: number, customFields: unknown) {
  const bot = await getBotUser();
  const missing = unanswered(r);
  const first = t.requesterName.split(' ')[0];
  const intro = rounds === 0
    ? `Hi ${first} — I can route this without the usual back-and-forth, I just need ${missing.length === 1 ? 'one thing' : 'a few quick answers'}:`
    : `Thanks! Almost there — ${missing.length === 1 ? 'one more thing' : 'just a couple more'}:`;
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'public', source: 'api',
    bodyText: `${intro}\n\n${missing.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nReply here and I'll send this straight to the right team.\n\n— SOTO Bot`,
  });
  await db.insert(ticketEvents).values({
    ticketId, actorId: bot.id, actorType: 'ai', eventType: 'intake_questions',
    field: 'intake', newValue: `${missing.length} question${missing.length === 1 ? '' : 's'}`, oldValue: flow.key,
  });
  await saveState(ticketId, customFields, { flow: flow.key, state: 'awaiting', rounds: rounds + 1 });
}

async function applyVerdict(ticketId: number, t: NonNullable<Awaited<ReturnType<typeof getTicket>>>, r: IntakeResult, flow: Flow) {
  const bot = await getBotUser();
  const first = t.requesterName.split(' ')[0];
  const isNew = r.verdict === 'new_access';
  const targetSlug = isNew ? flow.grantQueueSlug : flow.fixQueueSlug;
  const targetLabel = isNew ? flow.grantQueueLabel : flow.fixQueueLabel;

  const [target] = await db.select().from(teams).where(eq(teams.slug, targetSlug));
  if (target && target.id !== t.queueId) {
    const { applyTicketChanges } = await import('./ticketService.js');
    await applyTicketChanges(ticketId, { id: null, type: 'ai' }, { queueId: target.id });
  }

  // Structured handoff for the receiving team — the info the Service Desk
  // used to chase down by hand.
  const answers = Object.entries(r.answers)
    .map(([k, v]) => `- ${k}: ${v === null ? '—' : v ? 'yes' : 'no'}`)
    .join('\n');
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'internal', source: 'api',
    bodyText: `Intake result: ${isNew ? 'NEW ACCESS REQUEST' : 'BROKEN ACCESS'} (confidence ${Math.round(r.confidence * 100)}%)\n\nResources: ${r.resources.length ? r.resources.join(', ') : 'none named'}\n${answers}\n\nWhy: ${r.reasoning}\n\n— SOTO Bot`,
  });
  await db.insert(ticketComments).values({
    ticketId, authorId: bot.id, visibility: 'public', source: 'api',
    bodyText: isNew
      ? `Thanks ${first} — that's everything I need. This is a new-access request, so I've sent it straight to the ${targetLabel} to grant access to: ${r.resources.join(', ')}. You'll hear back here once it's applied.\n\n— SOTO Bot`
      : `Thanks ${first} — since this worked for you before, I'm treating it as a broken-access issue and the ${targetLabel} will investigate. You'll hear back here.\n\n— SOTO Bot`,
  });
  await db.insert(ticketEvents).values({
    ticketId, actorId: bot.id, actorType: 'ai', eventType: 'intake_resolved',
    field: 'intake', newValue: `${r.verdict} → ${targetSlug}`, oldValue: r.reasoning.slice(0, 200),
  });
  await saveState(ticketId, t.customFields, {
    flow: flow.key, state: 'resolved', rounds: 0, verdict: r.verdict, resources: r.resources,
  });
}

/**
 * After triage: does a guided-intake flow apply to this ticket? If the ticket
 * text already answers everything, route immediately; otherwise SOTO asks
 * only the unanswered questions.
 */
export async function maybeStartIntake(ticketId: number) {
  const t = await getTicket(ticketId);
  if (!t) return;
  const flow = FLOWS.find((f) => f.trigger.test(`${t.subject} ${t.description}`));
  if (!flow) return;
  if ((t.customFields as any)?.intake) return; // already started

  const r = await runParse(ticketId, t);
  if (r.verdict === 'not_access' && r.confidence >= CONFIDENT) {
    // A Databricks mention but not an access matter — normal triage owns it.
    await saveState(ticketId, t.customFields, { flow: flow.key, state: 'skipped', rounds: 0 });
    return;
  }
  if (actionable(r)) {
    await applyVerdict(ticketId, t, r, flow);
    return;
  }
  await postQuestions(ticketId, t, r, flow, 0, t.customFields);
}

/**
 * A requester replied on a ticket with intake awaiting answers — re-parse the
 * conversation and either route it or ask what's still missing (max
 * MAX_ROUNDS rounds, then a human takes over).
 */
export async function handleIntakeReply(ticketId: number) {
  const t = await getTicket(ticketId);
  if (!t) return;
  const intake = (t.customFields as any)?.intake as IntakeState | undefined;
  if (!intake || intake.state !== 'awaiting') return;
  const flow = FLOWS.find((f) => f.key === intake.flow);
  if (!flow) return;

  const r = await runParse(ticketId, t);
  if (actionable(r) || (r.verdict === 'not_access' && r.confidence >= CONFIDENT)) {
    if (r.verdict === 'not_access') {
      await saveState(ticketId, t.customFields, { ...intake, state: 'skipped' });
      return;
    }
    await applyVerdict(ticketId, t, r, flow);
    return;
  }
  if (intake.rounds >= MAX_ROUNDS) {
    const bot = await getBotUser();
    await db.insert(ticketComments).values({
      ticketId, authorId: bot.id, visibility: 'internal', source: 'api',
      bodyText: `Intake unresolved after ${intake.rounds} rounds — needs a human. Best read so far: ${r.verdict} (${Math.round(r.confidence * 100)}%). ${r.reasoning}\n\n— SOTO Bot`,
    });
    await saveState(ticketId, t.customFields, { ...intake, state: 'needs_human' });
    return;
  }
  await postQuestions(ticketId, t, r, flow, intake.rounds, t.customFields);
}
