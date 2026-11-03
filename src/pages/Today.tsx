import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { currentStreak, isDone, isScheduled } from '../../shared/habits.ts';
import { round1, weightStats } from '../../shared/health.ts';
import type { HealthState } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { post } from '../lib/api.ts';
import { addDays, formatLong, greeting, todayISO, weekStart } from '../lib/dates.ts';
import { useApi, useToday } from '../lib/useApi.ts';
import { AllDay, ConnectCalendar, EventRow, eventsByDay, useEvents } from './Calendar.tsx';
import { askCoach } from './Coach.tsx';
import { HabitCheck, useHabits } from './Habits.tsx';
import { OrderCard, stickerCount, useOrders } from './Orders.tsx';
import { QuickAdd, TodoRow, useTodos } from './Todos.tsx';
import { dueNow } from '../../shared/todos.ts';

export function TodayPage() {
  const today = useToday(todayISO);
  const health = useApi<HealthState>('/health');
  const name = health.data?.profile.name;

  return (
    <div className="stack">
      <PageHead title={`${greeting()}${name ? `, ${name}` : ''}`} sub={formatLong(today)} />
      <Schedule today={today} />
      <TodayTodos today={today} />
      <TodayHabits today={today} />
      <WeekOrders today={today} />
      {health.data && <HealthCard health={health.data} setHealth={health.setData} today={today} />}
    </div>
  );
}

function Schedule({ today }: { today: string }) {
  const { data, error } = useEvents(today, addDays(today, 1));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const list = useMemo(() => eventsByDay(data?.events ?? [], [today]).get(today) ?? [], [data, today]);
  const connected = data && (data.connected.links > 0 || data.connected.icloud);
  const timed = list.filter((e) => !e.allDay);
  const upcoming = timed.filter((e) => new Date(e.end).getTime() > now);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Schedule</h2>
        <a href="#/calendar">Week view</a>
      </div>
      {error && <div className="banner bad">{error}</div>}
      {data?.errors.map((e) => (
        <div key={e} className="banner" style={{ marginBottom: 8 }}>
          Couldn't load {e}
        </div>
      ))}
      {data && !connected && <ConnectCalendar />}
      {connected && (
        <>
          <AllDay events={list.filter((e) => e.allDay)} />
          {timed.map((e) => (
            <EventRow key={e.id} e={e} day={today} now={now} />
          ))}
          {!list.length && <div className="empty">Nothing on the calendar today.</div>}
          {timed.length > 0 && !upcoming.length && <div className="small muted">That's everything for today.</div>}
        </>
      )}
    </section>
  );
}

function TodayTodos({ today }: { today: string }) {
  const todos = useTodos();
  if (!todos.data) return todos.error ? <div className="banner bad">{todos.error}</div> : null;
  const list = dueNow(todos.data, today);
  const open = todos.data.filter((t) => !t.done).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          To-do{' '}
          {list.length > 0 && (
            <span className="muted small" style={{ fontWeight: 500 }}>
              {list.length} due
            </span>
          )}
        </h2>
        <a href="#/todos">All to-dos{open > list.length ? ` (${open})` : ''}</a>
      </div>
      {!list.length && <div className="empty">Nothing due today.</div>}
      {list.map((t) => (
        <TodoRow key={t.id} t={t} todos={todos} today={today} showDue={t.dueDate !== today} />
      ))}
      <div style={{ marginTop: 10 }}>
        <QuickAdd todos={todos} today={today} defaultDue={today} compact />
      </div>
    </section>
  );
}

function TodayHabits({ today }: { today: string }) {
  const { data, error, toggle } = useHabits();
  if (!data) return error ? <div className="banner bad">{error}</div> : null;
  const due = data.habits.filter((h) => !h.archived && (isScheduled(h, today) || isDone(data, h.id, today)));
  const done = due.filter((h) => isDone(data, h.id, today)).length;

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Habits{' '}
          {due.length > 0 && (
            <span className="muted small" style={{ fontWeight: 500 }}>
              {done}/{due.length}
            </span>
          )}
        </h2>
        <a href="#/habits">All habits</a>
      </div>
      {due.length > 0 && (
        <div className="bar" style={{ marginBottom: 4 }}>
          <span style={{ width: `${(done / due.length) * 100}%` }} />
        </div>
      )}
      {!due.length && (
        <div className="empty">
          {data.habits.length ? 'No habits scheduled today.' : <>No habits yet. <a href="#/habits">Add one</a>.</>}
        </div>
      )}
      {due.map((h) => {
        const on = isDone(data, h.id, today);
        const streak = currentStreak(data, h, today);
        return (
          <div key={h.id} className={`habit ${on ? 'done' : ''}`}>
            <span className="emoji" aria-hidden>
              {h.emoji}
            </span>
            <div className="grow">
              <div className="name">{h.name}</div>
              {streak > 0 && <div className="streak">🔥 {streak}</div>}
            </div>
            <HabitCheck on={on} onClick={() => toggle(h, today)} label={`${h.name} ${on ? 'done' : 'not done'}`} />
          </div>
        );
      })}
      {due.length > 0 && done === due.length && <div className="small" style={{ color: 'var(--good)', marginTop: 8, fontWeight: 600 }}>All done today. Nice work!</div>}
    </section>
  );
}

function WeekOrders({ today }: { today: string }) {
  const { data, setStatus } = useOrders();
  if (!data) return null;
  const ws = weekStart(today);
  const we = addDays(ws, 7);
  const week = data.filter((o) => o.dueDate >= ws && o.dueDate < we);
  const shipped = week.filter((o) => o.status === 'shipped').length;
  const open = data
    .filter((o) => o.status !== 'shipped' && o.dueDate < we)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);
  const openStickers = data.filter((o) => o.status !== 'shipped' && o.dueDate < we).reduce((n, o) => n + stickerCount(o), 0);

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Sticker orders{' '}
          {week.length > 0 && (
            <span className="muted small" style={{ fontWeight: 500 }}>
              {shipped}/{week.length} shipped
            </span>
          )}
        </h2>
        <a href="#/orders">All orders</a>
      </div>
      {week.length > 0 && (
        <div className="bar" style={{ marginBottom: 10 }}>
          <span style={{ width: `${(shipped / week.length) * 100}%` }} />
        </div>
      )}
      {!open.length && <div className="empty">{week.length ? 'Everything due this week has shipped. 🎉' : <>No orders due this week. <a href="#/orders">Add one</a>.</>}</div>}
      {open.map((o) => (
        <OrderCard key={o.id} order={o} today={today} onStatus={setStatus} />
      ))}
      {openStickers > 0 && <div className="small muted" style={{ marginTop: 8 }}>{openStickers.toLocaleString()} stickers left to make this week</div>}
    </section>
  );
}

function HealthCard({ health, setHealth, today }: { health: HealthState; setHealth: (h: HealthState) => void; today: string }) {
  const { profile, weights } = health;
  const s = weightStats(weights, profile, today);
  const [value, setValue] = useState('');
  const loggedToday = weights.find((w) => w.date === today);

  async function log(e: FormEvent) {
    e.preventDefault();
    setHealth(await post<HealthState>('/health/weights', { date: today, weight: Number(value) }));
    setValue('');
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Health</h2>
        <a href="#/coach/progress">Progress</a>
      </div>
      <div className="row wrap" style={{ gap: 18, marginBottom: 12 }}>
        <div>
          <div className="small text-2">7-day average</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{s.avg7 !== undefined ? `${round1(s.avg7)} ${profile.units}` : '–'}</div>
        </div>
        <div>
          <div className="small text-2">To goal</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{s.toGo !== undefined ? `${round1(Math.max(0, s.toGo))} ${profile.units}` : profile.goalWeight ? '–' : <a href="#/coach/goals" style={{ fontSize: '0.95rem' }}>Set goal</a>}</div>
        </div>
        {s.weeklyTrend !== undefined && (
          <div>
            <div className="small text-2">Trend</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
              {s.weeklyTrend > 0 ? '+' : ''}
              {round1(s.weeklyTrend)}/wk
            </div>
          </div>
        )}
      </div>
      {loggedToday ? (
        <p className="small text-2">
          Weighed in today: <strong>{loggedToday.weight} {profile.units}</strong>
        </p>
      ) : (
        <form className="row" onSubmit={log}>
          <input type="number" inputMode="decimal" step="0.1" min="1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Today's weight (${profile.units})`} aria-label="Today's weight" />
          <button className="btn" disabled={!value}>
            Log
          </button>
        </form>
      )}
      <button className="btn primary" style={{ marginTop: 12, width: '100%' }} onClick={() => askCoach("Give me my plan for today: one workout that fits my calendar and what to focus on with food.")}>
        <Icon name="sparkle" size={18} /> Ask coach for today's plan
      </button>
    </section>
  );
}
