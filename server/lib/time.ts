// Date and time-zone helpers. The server may run in a different time zone than
// the person using the app, so anything "local" is computed for an explicit
// IANA zone (sent by the browser) rather than the server clock.

import type { ISODate } from '../../shared/types.ts';

const zoneCache = new Map<string, boolean>();

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  let ok = zoneCache.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneCache.set(tz, ok);
  }
  return ok;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockParts(ts: number, tz: string) {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at instant `ts`, in milliseconds. */
function zoneOffset(ts: number, tz: string): number {
  const p = wallClockParts(ts, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to a UTC epoch (ms). month is 1-12. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - zoneOffset(guess, tz);
  // Re-check at the candidate instant so DST transitions land correctly.
  return guess - zoneOffset(first, tz);
}

export function parseISODate(d: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = d.split('-').map(Number);
  return { year, month, day };
}

export function isISODate(d: unknown): d is ISODate {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const { year, month, day } = parseISODate(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/** Add whole days to a calendar date (no time-zone involvement). */
export function addDays(d: ISODate, n: number): ISODate {
  const { year, month, day } = parseISODate(d);
  const dt = new Date(Date.UTC(year, month - 1, day + n));
  return dt.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(d: ISODate): number {
  const { year, month, day } = parseISODate(d);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Monday of the week containing `d`. */
export function weekStart(d: ISODate): ISODate {
  const dow = dayOfWeek(d);
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

/** UTC instants bounding the local calendar day(s) [startDate, endDate) in `tz`. */
export function zonedRange(startDate: ISODate, endDateExclusive: ISODate, tz: string): { start: Date; end: Date } {
  const s = parseISODate(startDate);
  const e = parseISODate(endDateExclusive);
  return {
    start: new Date(zonedToUtc(s.year, s.month, s.day, 0, 0, 0, tz)),
    end: new Date(zonedToUtc(e.year, e.month, e.day, 0, 0, 0, tz)),
  };
}

/** Calendar date of instant `ts` in `tz`. */
export function dateInZone(ts: number | Date, tz: string): ISODate {
  const p = wallClockParts(typeof ts === 'number' ? ts : ts.getTime(), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function formatTimeInZone(ts: number | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ts);
}

export function formatDateLong(d: ISODate): string {
  const { year, month, day } = parseISODate(d);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
