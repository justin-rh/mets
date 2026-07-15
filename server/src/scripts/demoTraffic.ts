// Demo traffic generator: submits a batch of realistic tickets through the
// full intake pipeline (routing rules → SLA attachment → live AI triage) so
// the AI Decision Log shows real decisions being made.
// Run: npm run demo:traffic  (server not required — runs in-process)
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../db/index.js';
import { createTicketCore } from '../services/ticketService.js';
import { enrichTicket } from '../services/ai/enrichment.js';

const BATCH_SIZE = 10;

// `npm run demo:traffic -- outage`: a burst of same-root-cause reports that
// should trip suspected-incident detection (parent ticket + linked children).
const OUTAGE_BURST: { subject: string; description: string; type?: 'incident' | 'request' | 'change' }[] = [
  { subject: 'Zoom won\'t connect — meetings failing', description: 'Zoom desktop client says "unable to connect" for every meeting since about 10 minutes ago. Tried restarting, same thing.' },
  { subject: 'Zoom down for our whole team', description: 'Nobody on the inside sales team can join Zoom calls — clients are waiting in meetings we cannot join. Started within the last 15 minutes.' },
  { subject: 'Cannot join any Zoom meetings', description: 'Every Zoom link errors out with code 5003. My 11am customer call is in 20 minutes. Phone app fails too.' },
  { subject: 'Zoom connection error 5003 in conference rooms', description: 'Both Phoenix conference room Zoom Rooms panels show a connection error. In-person attendees fine, remote folks cannot join.' },
];

// A spread of clear-cut and deliberately ambiguous tickets, so the log shows
// both auto-applies and held-for-review suggestions.
const SAMPLES: { subject: string; description: string; type?: 'incident' | 'request' | 'change' }[] = [
  { subject: 'VPN drops every time I switch from dock to wifi', description: 'Whenever I undock my Lenovo ThinkPad and move to a conference room, the VPN dies and takes 2-3 minutes to reconnect. Happens every time.' },
  { subject: 'Payroll shows 32 hours but I worked 40', description: 'UKG is showing me at 32 hours for last week but I worked all five days. Payroll runs Thursday — can someone fix my punches before then?' },
  { subject: 'CrowdStrike blocked our label template editor', description: 'CrowdStrike quarantined the ZebraDesigner installer we use to edit label templates. Receiving needs an updated label format by Friday.' },
  { subject: 'Zoom Rooms mic not picking up far end of table', description: 'In the large Phoenix conference room, people at the far end of the table are inaudible on Zoom calls. Customer QBR scheduled in there next week.' },
  { subject: 'Need MERP access for two new inside sales reps', description: 'Two new inside sales team members start Monday and need MERP order-entry access mirroring the rest of the team.', type: 'request' },
  { subject: 'AMAT portal shows overdue lines that we shipped', description: 'The AMAT supplier portal is flagging six lines as overdue but our records show they shipped last week with tracking. Their buyer is asking for an explanation today.' },
  { subject: 'Slack keeps logging me out on mobile', description: 'The Slack mobile app signs me out every few hours and makes me re-authenticate. Desktop is fine. Annoying when I am on the warehouse floor.' },
  { subject: 'Quote tool rounding pennies differently than MERP again', description: 'Large quantity quote for a customer shows $10,412.16 in the quote tool but MERP books it at $10,412.09. Customer notices these things.' },
  { subject: 'RoHS certs needed before customer audit Thursday', description: 'Customer audit on Thursday requires RoHS/REACH certificates for everything we shipped them in Q2. Can Quality pull these together?' },
  { subject: 'Something is wrong with my computer', description: 'My computer has been acting weird since this morning. Sometimes it is slow, sometimes fine. Not sure if it is the machine or the network.' },
  { subject: 'FedEx labels printing with wrong ship-from address', description: 'FedEx shipments from the Germantown warehouse are printing labels with the Phoenix ship-from address. Started after the shipping software update.' },
  { subject: 'Claude license for the pricing team', description: 'The pricing team wants Claude access to help draft supplier negotiation summaries. Five seats, manager approved.', type: 'request' },
  { subject: 'Keeper shared folder missing for new hire', description: 'Our new team member cannot see the department shared folder in Keeper even though she was added to the team yesterday.' },
  { subject: 'Forklift certification not reflected in badge access', description: 'I recertified on the forklift two weeks ago but my badge still will not open the equipment cage. Training records show me as current.' },
  { subject: 'Dashboard for daily bookings by branch', description: 'Sales leadership wants a Power BI dashboard showing daily bookings by branch and salesperson, refreshed every morning.', type: 'request' },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function main() {
  const requesters = await db.select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.role, 'requester'));
  if (requesters.length === 0) throw new Error('no requesters — seed first');

  const outageMode = process.argv.includes('outage');
  const batch = outageMode ? OUTAGE_BURST : shuffle(SAMPLES).slice(0, BATCH_SIZE);
  console.log(`Submitting ${batch.length} ${outageMode ? 'outage-burst' : ''} tickets through the live pipeline…\n`);

  for (const sample of batch) {
    const requester = requesters[Math.floor(Math.random() * requesters.length)]!;
    const created = await createTicketCore({
      subject: sample.subject,
      description: sample.description,
      type: sample.type ?? 'incident',
      requesterId: requester.id,
      source: Math.random() < 0.4 ? 'email' : 'portal',
    });
    let outcome = 'ai failed (kept as-is)';
    try {
      const enrichment = await enrichTicket(created.id, 'auto');
      const r = enrichment.result as any;
      outcome = `${r.category} → ${r.queueSlug} · P${r.priority} (${enrichment.status})`;
    } catch { /* AI is off the critical path */ }
    console.log(`${created.number}  ${sample.subject.slice(0, 52).padEnd(52)}  ${outcome}`);
  }

  console.log('\nDone — open AI Triage to see the decision log.');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
