// Parse iCalendar (.ics) text and expand it into concrete event occurrences
// inside a date range. Handles recurring events (RRULE/RDATE/EXDATE), moved or
// cancelled single occurrences (RECURRENCE-ID), all-day events and time zones.

import ICAL from 'ical.js';
import type { CalendarEvent, ISODate } from '../../shared/types.ts';
import { isValidTimeZone, zonedToUtc } from '../lib/time.ts';

type Time = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type Component = InstanceType<typeof ICAL.Component>;

export interface ExpandOptions {
  /** Inclusive first local date. */
  startDate: ISODate;
  /** Exclusive last local date. */
  endDate: ISODate;
  /** UTC instants matching startDate/endDate in the user's zone. */
  rangeStart: Date;
  rangeEnd: Date;
  /** User's IANA zone, used for "floating" times with no zone attached. */
  userTz: string;
  calendar: string;
  color: string;
  sourceId: string;
}

const MAX_OCCURRENCES_SCANNED = 20000;
// Scan a little past the range so an occurrence moved earlier into the range is found.
const LOOKAHEAD_MS = 60 * 86400_000;

function registerTimezones(root: Component) {
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tzid = vtz.getFirstPropertyValue('tzid');
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      try {
        ICAL.TimezoneService.register(vtz);
      } catch {
        // A malformed VTIMEZONE just means we fall back to Intl / the user's zone.
      }
    }
  }
}

function tzidOf(comp: Component, prop: 'dtstart' | 'dtend'): string | undefined {
  const p = comp.getFirstProperty(prop) ?? (prop === 'dtend' ? comp.getFirstProperty('dtstart') : null);
  const v = p?.getParameter('tzid');
  return typeof v === 'string' ? v : undefined;
}

/** Convert an ICAL.Time to a JS Date, preferring the platform's IANA time-zone data. */
function toInstant(t: Time, tzid: string | undefined, userTz: string): Date {
  if (t.zone === ICAL.Timezone.utcTimezone) return t.toJSDate();
  const wall = (tz: string) => new Date(zonedToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tz));
  if (tzid && isValidTimeZone(tzid)) return wall(tzid);
  // Non-IANA TZID (e.g. "Eastern Standard Time") defined by a VTIMEZONE in the file.
  if (tzid && ICAL.TimezoneService.has(tzid)) return t.toJSDate();
  return wall(userTz);
}

function dateString(t: Time): ISODate {
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function isCancelled(comp: Component): boolean {
  return String(comp.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function text(comp: Component, prop: string): string | undefined {
  const v = comp.getFirstPropertyValue(prop);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function occurrence(
  item: IcalEvent,
  start: Time,
  end: Time,
  idSuffix: string,
  o: ExpandOptions,
): CalendarEvent | null {
  const comp = item.component;
  if (isCancelled(comp)) return null;
  const base = {
    id: `${o.sourceId}:${item.uid}:${idSuffix}`,
    title: item.summary?.trim() || '(No title)',
    location: text(comp, 'location'),
    calendar: o.calendar,
    color: o.color,
  };

  if (start.isDate) {
    const s = dateString(start);
    let e = end && end.isDate ? dateString(end) : s;
    if (e <= s) {
      // DTEND missing or equal → one-day event.
      const next = start.clone();
      next.adjust(1, 0, 0, 0);
      e = dateString(next);
    }
    if (s >= o.endDate || e <= o.startDate) return null;
    return { ...base, start: s, end: e, allDay: true };
  }

  const s = toInstant(start, tzidOf(comp, 'dtstart'), o.userTz);
  let e = end ? toInstant(end, tzidOf(comp, 'dtend'), o.userTz) : s;
  if (e < s) e = s;
  const overlaps = s < o.rangeEnd && (e > o.rangeStart || (e.getTime() === s.getTime() && s >= o.rangeStart));
  if (!overlaps) return null;
  return { ...base, start: s.toISOString(), end: e.toISOString(), allDay: false };
}

export function expandIcs(icsText: string, o: ExpandOptions): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(icsText));
  registerTimezones(root);

  const masters = new Map<string, IcalEvent>();
  const orphans: IcalEvent[] = [];
  const exceptions: IcalEvent[] = [];
  for (const ve of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (!ev.startDate) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else orphans.push(ex); // e.g. CalDAV returned only the modified instance
  }

  const out: CalendarEvent[] = [];
  const scanUntil = o.rangeEnd.getTime() + LOOKAHEAD_MS;

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      const occ = occurrence(ev, ev.startDate, ev.endDate, ev.startDate.toString(), o);
      if (occ) out.push(occ);
      continue;
    }
    const masterTz = tzidOf(ev.component, 'dtstart');
    const it = ev.iterator();
    for (let i = 0; i < MAX_OCCURRENCES_SCANNED; i++) {
      const next = it.next();
      if (!next) break;
      const nominal = next.isDate
        ? Date.UTC(next.year, next.month - 1, next.day)
        : toInstant(next, masterTz, o.userTz).getTime();
      if (nominal > scanUntil) break;
      const details = ev.getOccurrenceDetails(next);
      const occ = occurrence(details.item, details.startDate, details.endDate, next.toString(), o);
      if (occ) out.push(occ);
    }
  }

  for (const ex of orphans) {
    const occ = occurrence(ex, ex.startDate, ex.endDate, ex.recurrenceId?.toString() ?? ex.startDate.toString(), o);
    if (occ) out.push(occ);
  }

  return out;
}

/** Sort: all-day first within a day, then by start time. */
export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.sort((a, b) => {
    const ak = a.allDay ? `${a.start}T00:00:00.000Z` : a.start;
    const bk = b.allDay ? `${b.start}T00:00:00.000Z` : b.start;
    if (ak !== bk) return ak < bk ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}
