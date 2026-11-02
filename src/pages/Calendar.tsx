import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CalendarResponse, ISODate } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { api } from '../lib/api.ts';
import { PageHead } from '../components/PageHead.tsx';
import { addDays, formatTime, formatWeekRange, fromISODate, todayISO, toISODate, userTz, weekDates, weekStart } from '../lib/dates.ts';
import { useApi, useToday } from '../lib/useApi.ts';

export function useEvents(start: ISODate, end: ISODate) {
  const path = `/calendar/events?start=${start}&end=${end}&tz=${encodeURIComponent(userTz())}`;
  const res = useApi<CalendarResponse>(path);
  /** Re-download calendars, skipping the server's 5-minute cache. */
  const refresh = async () => {
    try {
      res.setData(await api<CalendarResponse>(`${path}&refresh=1`));
    } catch (err) {
      res.setError(err instanceof Error ? err.message : String(err));
    }
  };
  return { ...res, refresh };
}

/** Split events into per-local-day buckets; multi-day events appear on each day. */
export function eventsByDay(events: CalendarEvent[], days: ISODate[]): Map<ISODate, CalendarEvent[]> {
  const map = new Map<ISODate, CalendarEvent[]>(days.map((d) => [d, []]));
  for (const e of events) {
    for (const d of days) {
      const dayStart = fromISODate(d).getTime();
      const dayEnd = fromISODate(addDays(d, 1)).getTime();
      const hit = e.allDay
        ? e.start <= d && e.end > d
        : new Date(e.start).getTime() < dayEnd && (new Date(e.end).getTime() > dayStart || (e.start === e.end && new Date(e.start).getTime() >= dayStart));
      if (hit) map.get(d)!.push(e);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
  }
  return map;
}

export function EventRow({ e, day, now }: { e: CalendarEvent; day: ISODate; now: number }) {
  const s = new Date(e.start).getTime();
  const en = new Date(e.end).getTime();
  const startsToday = toISODate(new Date(e.start)) === day;
  const endsToday = toISODate(new Date(Math.max(s, en - 1))) === day;
  const when = startsToday ? formatTime(e.start) : 'cont.';
  const until = endsToday ? formatTime(e.end) : '…';
  const state = en <= now ? 'past' : s <= now ? 'now' : '';
  return (
    <div className={`event ${state}`}>
      <span className="stripe" style={{ background: e.color }} />
      <div className="when">
        {when}
        {en > s && (
          <>
            <br />
            <span className="muted">{until}</span>
          </>
        )}
      </div>
      <div className="grow">
        <div className="title">{e.title}</div>
        <div className="small muted ellipsis">{[e.location, e.calendar].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

export function AllDay({ events }: { events: CalendarEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="allday">
      {events.map((e) => (
        <span key={e.id} style={{ borderLeftColor: e.color }} title={e.calendar}>
          {e.title}
        </span>
      ))}
    </div>
  );
}

export function ConnectCalendar() {
  return (
    <div className="empty">
      Your Apple Calendar isn't connected yet. <a href="#/settings">Connect it in Settings</a>.
    </div>
  );
}

export function CalendarPage() {
  const today = useToday(todayISO);
  const [start, setStart] = useState(() => weekStart(today));
  const days = useMemo(() => weekDates(start), [start]);
  const { data, error, loading, refresh } = useEvents(start, addDays(start, 7));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const byDay = useMemo(() => eventsByDay(data?.events ?? [], days), [data, days]);
  const connected = data && (data.connected.links > 0 || data.connected.icloud);

  return (
    <div className="stack">
      <PageHead title="Calendar" sub={formatWeekRange(start)}>
        <button className="icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" />
        </button>
      </PageHead>

      <div className="spread">
        <button className="icon-btn" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
          <Icon name="left" />
        </button>
        <button className="btn sm" onClick={() => setStart(weekStart(today))} disabled={start === weekStart(today)}>
          This week
        </button>
        <button className="icon-btn" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
          <Icon name="right" />
        </button>
      </div>

      {error && <div className="banner bad">{error}</div>}
      {data?.errors.map((e) => (
        <div key={e} className="banner">
          Couldn't load {e}
        </div>
      ))}

      <section className="card">
        {data && !connected && <ConnectCalendar />}
        {loading && !data && <div className="empty">Loading…</div>}
        {connected &&
          days.map((d) => {
            const list = byDay.get(d) ?? [];
            const allDay = list.filter((e) => e.allDay);
            const timed = list.filter((e) => !e.allDay);
            const date = fromISODate(d);
            return (
              <div key={d} className="day">
                <div className={`day-head ${d === today ? 'today' : ''}`}>
                  <span className="dnum">{date.getDate()}</span>
                  <span className="dname">{date.toLocaleDateString(undefined, { weekday: 'long' })}</span>
                  {d === today && <span className="chip accent">Today</span>}
                </div>
                <AllDay events={allDay} />
                {timed.map((e) => (
                  <EventRow key={e.id} e={e} day={d} now={now} />
                ))}
                {!list.length && <div className="small muted">Free</div>}
              </div>
            );
          })}
      </section>
    </div>
  );
}
