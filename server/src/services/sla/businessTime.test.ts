// Sanity checks for business-time math. Run: npx tsx src/services/sla/businessTime.test.ts
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from './businessTime.js';

const CAL: BusinessCalendar = { timezone: 'America/Phoenix', days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };
// A calendar in a DST-observing zone to prove the math survives transitions.
const NY: BusinessCalendar = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };

let failures = 0;
function eq(name: string, actual: string | number, expected: string | number) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}${pass ? '' : ` (expected ${expected})`}`);
}
const iso = (d: Date, tz = 'America/Phoenix') =>
  d.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');

// Phoenix is UTC-7 year-round. 2026-07-10 is a Friday.
const fri1630 = new Date('2026-07-10T23:30:00Z'); // Fri 16:30 Phoenix

eq('30min within day', iso(addBusinessMinutes(fri1630, 30, CAL)), '2026-07-10T17:00:00');
eq('60min spans weekend', iso(addBusinessMinutes(fri1630, 60, CAL)), '2026-07-13T08:30:00');
eq('full day (540m) from Fri 16:30', iso(addBusinessMinutes(fri1630, 540, CAL)), '2026-07-13T16:30:00');

const sat = new Date('2026-07-11T18:00:00Z'); // Saturday 11:00 Phoenix
eq('weekend start clamps to Monday', iso(addBusinessMinutes(sat, 30, CAL)), '2026-07-13T08:30:00');

const before = new Date('2026-07-10T13:00:00Z'); // Fri 06:00 Phoenix (before open)
eq('pre-open start clamps to open', iso(addBusinessMinutes(before, 15, CAL)), '2026-07-10T08:15:00');

// 1440m = two full 9h days (540m each) + 360m into the third day
const mon0800 = new Date('2026-07-13T15:00:00Z'); // Mon 08:00 Phoenix
eq('1440m from Mon 08:00', iso(addBusinessMinutes(mon0800, 1440, CAL)), '2026-07-15T14:00:00');

// between: inverse property
const target = addBusinessMinutes(fri1630, 200, CAL);
eq('between inverts add', Math.round(businessMinutesBetween(fri1630, target, CAL)), 200);
eq('between over weekend only', Math.round(businessMinutesBetween(
  new Date('2026-07-11T00:00:00Z'), new Date('2026-07-12T23:00:00Z'), CAL)), 0);
eq('b <= a is zero', businessMinutesBetween(target, fri1630, CAL), 0);

// DST spring-forward in New York: Sun 2026-03-08 02:00 -> 03:00.
// Fri 2026-03-06 16:30 ET + 60 business minutes must land Mon 08:30 ET
// regardless of the clocks jumping over the weekend.
const friBeforeDst = new Date('2026-03-06T21:30:00Z'); // Fri 16:30 EST (UTC-5)
eq('DST spring-forward weekend', iso(addBusinessMinutes(friBeforeDst, 60, NY), 'America/New_York'), '2026-03-09T08:30:00');
// And the inverse across the transition:
const dstTarget = addBusinessMinutes(friBeforeDst, 300, NY);
eq('DST between inverts add', Math.round(businessMinutesBetween(friBeforeDst, dstTarget, NY)), 300);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
