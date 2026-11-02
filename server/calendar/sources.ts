// Where calendar data comes from:
//  1. Calendar links (.ics / webcal://) — e.g. an iCloud calendar shared as a
//     "Public Calendar", or any other subscribed calendar feed.
//  2. iCloud over CalDAV, using an Apple ID + app-specific password from the
//     environment. This sees every calendar on the account without making any
//     of them public.

import { createDAVClient } from 'tsdav';
import type { CalendarEvent, CalendarSource, ISODate } from '../../shared/types.ts';
import { expandIcs } from './ics.ts';
import { config } from '../config.ts';

export interface RangeQuery {
  startDate: ISODate;
  endDate: ISODate;
  rangeStart: Date;
  rangeEnd: Date;
  userTz: string;
}

const CACHE_MS = 5 * 60_000;
const icsCache = new Map<string, { at: number; text: string }>();

export function normalizeCalendarUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.replace(/^webcals?:\/\//i, 'https://');
}

async function fetchIcs(url: string, force: boolean): Promise<string> {
  const hit = icsCache.get(url);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const res = await fetch(url, {
    headers: { Accept: 'text/calendar, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('response is not an iCalendar file');
  icsCache.set(url, { at: Date.now(), text });
  return text;
}

async function linkEvents(src: CalendarSource, q: RangeQuery, force: boolean): Promise<CalendarEvent[]> {
  const text = await fetchIcs(normalizeCalendarUrl(src.url), force);
  return expandIcs(text, { ...q, calendar: src.name, color: src.color, sourceId: src.id });
}

// ---------- CalDAV (iCloud) ----------

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;
let davClient: { at: number; client: DAVClient } | null = null;
const davCache = new Map<string, { at: number; events: CalendarEvent[] }>();

async function getDavClient(): Promise<DAVClient> {
  if (davClient && Date.now() - davClient.at < 30 * 60_000) return davClient.client;
  const client = await createDAVClient({
    serverUrl: config.caldav.serverUrl,
    credentials: { username: config.caldav.username, password: config.caldav.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  davClient = { at: Date.now(), client };
  return client;
}

function davColor(raw: unknown, fallback: string): string {
  // Apple sends colors like "#FF2968FF" (RGBA); browsers want #RRGGBB.
  if (typeof raw === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) return raw.slice(0, 7);
  return fallback;
}

const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c'];

async function caldavEvents(q: RangeQuery, force: boolean): Promise<CalendarEvent[]> {
  const key = `${q.rangeStart.toISOString()}|${q.rangeEnd.toISOString()}|${q.userTz}`;
  const hit = davCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.events;

  const client = await getDavClient();
  const calendars = (await client.fetchCalendars()).filter(
    (c) => !c.components || c.components.includes('VEVENT'),
  );
  const wanted = config.caldav.calendars;
  const chosen = wanted.length
    ? calendars.filter((c) => wanted.includes(String(c.displayName ?? '').toLowerCase()))
    : calendars;

  const events: CalendarEvent[] = [];
  await Promise.all(
    chosen.map(async (cal, i) => {
      const name = String(cal.displayName || 'iCloud');
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: q.rangeStart.toISOString(), end: q.rangeEnd.toISOString() },
      });
      for (const obj of objects) {
        if (typeof obj.data !== 'string' || !obj.data.includes('BEGIN:VEVENT')) continue;
        try {
          events.push(
            ...expandIcs(obj.data, {
              ...q,
              calendar: name,
              color: davColor(cal.calendarColor, PALETTE[i % PALETTE.length]),
              sourceId: `icloud-${i}`,
            }),
          );
        } catch {
          // Skip a single unparseable event rather than failing the whole calendar.
        }
      }
    }),
  );
  davCache.set(key, { at: Date.now(), events });
  return events;
}

export async function loadEvents(
  sources: CalendarSource[],
  q: RangeQuery,
  force = false,
): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  const errors: string[] = [];
  const jobs: Promise<CalendarEvent[]>[] = sources.map((s) =>
    linkEvents(s, q, force).catch((err: unknown) => {
      errors.push(`${s.name}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }),
  );
  if (config.caldav.enabled) {
    jobs.push(
      caldavEvents(q, force).catch((err: unknown) => {
        davClient = null; // force a fresh login next time
        errors.push(`iCloud: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }),
    );
  }
  const events = (await Promise.all(jobs)).flat();
  return { events, errors };
}
