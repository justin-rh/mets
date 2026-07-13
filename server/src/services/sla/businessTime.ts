// Business-hours arithmetic — the one pure function the SLA engine depends
// on. All math happens in the calendar's IANA timezone (DST-safe by
// construction; Phoenix happens not to observe DST, but nothing here assumes
// that). Holidays are a v2 field on the calendar.
import { DateTime } from 'luxon';

export type BusinessCalendar = {
  timezone: string;      // IANA, e.g. 'America/Phoenix'
  days: number[];        // ISO weekdays, 1=Mon .. 7=Sun
  start: string;         // 'HH:mm'
  end: string;           // 'HH:mm'
};

function window(dt: DateTime, cal: BusinessCalendar): { open: DateTime; close: DateTime } | null {
  if (!cal.days.includes(dt.weekday)) return null;
  const [sh, sm] = cal.start.split(':').map(Number);
  const [eh, em] = cal.end.split(':').map(Number);
  return {
    open: dt.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }),
    close: dt.set({ hour: eh, minute: em, second: 0, millisecond: 0 }),
  };
}

const GUARD_DAYS = 3700; // ~10 years of calendar walking; far beyond any SLA

/** The wall-clock instant `minutes` business-minutes after `start`. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  let dt = DateTime.fromJSDate(start).setZone(cal.timezone);
  let remaining = minutes;
  for (let i = 0; i < GUARD_DAYS; i++) {
    const win = window(dt, cal);
    if (win && dt < win.close) {
      const cursor = dt > win.open ? dt : win.open;
      const available = win.close.diff(cursor, 'minutes').minutes;
      if (remaining <= available) return cursor.plus({ minutes: remaining }).toJSDate();
      remaining -= available;
    }
    dt = dt.plus({ days: 1 }).startOf('day');
  }
  throw new Error('addBusinessMinutes exceeded guard — check calendar config');
}

/** Business minutes elapsed between two instants (0 if b <= a). */
export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  const end = DateTime.fromJSDate(b).setZone(cal.timezone);
  let dt = DateTime.fromJSDate(a).setZone(cal.timezone);
  if (end <= dt) return 0;
  let total = 0;
  for (let i = 0; i < GUARD_DAYS && dt < end; i++) {
    const win = window(dt, cal);
    if (win) {
      const from = dt > win.open ? dt : win.open;
      const to = end < win.close ? end : win.close;
      if (to > from) total += to.diff(from, 'minutes').minutes;
    }
    dt = dt.plus({ days: 1 }).startOf('day');
  }
  return total;
}
