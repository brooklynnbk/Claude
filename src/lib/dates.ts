// Local-time date helpers for the browser. Dates are YYYY-MM-DD strings in the
// device's time zone.

import type { ISODate } from '../../shared/types.ts';

export const userTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayISO = () => toISODate(new Date());

export function fromISODate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = fromISODate(d);
  dt.setDate(dt.getDate() + n);
  return toISODate(dt);
}

/** Monday of the week containing d. */
export function weekStart(d: ISODate): ISODate {
  const dow = fromISODate(d).getDay();
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

export const weekDates = (start: ISODate) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const F = {
  long: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
  short: fmt({ month: 'short', day: 'numeric' }),
  wkShort: fmt({ weekday: 'short' }),
  wkNarrow: fmt({ weekday: 'narrow' }),
  wkShortDate: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
  time: fmt({ hour: 'numeric', minute: '2-digit' }),
};

export const formatLong = (d: ISODate) => F.long.format(fromISODate(d));
export const formatShort = (d: ISODate) => F.short.format(fromISODate(d));
export const formatWeekday = (d: ISODate) => F.wkShort.format(fromISODate(d));
export const formatWeekdayNarrow = (d: ISODate) => F.wkNarrow.format(fromISODate(d));
export const formatWeekdayDate = (d: ISODate) => F.wkShortDate.format(fromISODate(d));
export const formatTime = (iso: string) => F.time.format(new Date(iso)).replace(':00', '').replace(/\s/g, '').toLowerCase();

export function formatWeekRange(start: ISODate): string {
  const end = addDays(start, 6);
  const s = fromISODate(start);
  const e = fromISODate(end);
  if (s.getMonth() === e.getMonth()) return `${F.short.format(s)} – ${e.getDate()}`;
  return `${F.short.format(s)} – ${F.short.format(e)}`;
}

export function relativeDay(d: ISODate, today = todayISO()): string {
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  if (d === addDays(today, -1)) return 'Yesterday';
  return formatWeekdayDate(d);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
