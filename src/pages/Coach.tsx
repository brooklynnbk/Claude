import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import { round1, weightStats } from '../../shared/health.ts';
import type { ChatItem, CoachState, HealthProfile, HealthState } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { del, post, put } from '../lib/api.ts';
import { addDays, formatShort, todayISO, userTz } from '../lib/dates.ts';
import { go } from '../lib/router.ts';
import { settingsPlace, useAppInfo } from '../lib/appInfo.ts';
import { useApi, useToday } from '../lib/useApi.ts';

type Tab = 'chat' | 'progress' | 'goals';

export function CoachPage({ tab: initial }: { tab?: string }) {
  const tab: Tab = initial === 'progress' || initial === 'goals' ? initial : 'chat';
  const health = useApi<HealthState>('/health');

  return (
    <div className="stack">
      <PageHead title="Health coach" />
      <div className="seg full" role="tablist">
        {(
          [
            ['chat', 'Coach'],
            ['progress', 'Progress'],
            ['goals', 'Goals'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go('coach', id === 'chat' ? undefined : id)}>
            {label}
          </button>
        ))}
      </div>
      {health.error && <div className="banner bad">{health.error}</div>}
      {tab === 'chat' && <Chat onDataChanged={health.reload} />}
      {tab === 'progress' && health.data && <Progress health={health.data} setHealth={health.setData} />}
      {tab === 'goals' && health.data && <Goals health={health.data} setHealth={health.setData} />}
    </div>
  );
}

// ---------------------------------------------------------------- Chat

const PROMPTS = [
  'Plan my workouts around my calendar this week',
  'What should I eat today?',
  'Weekly check-in: how am I doing?',
  'Suggest one habit that would help most',
  'I have 20 minutes. Give me a quick workout.',
];

const CONSUMED_KEY = 'hq.coach.prefill';

/** Let other pages open the coach with a message ready to send. */
export function askCoach(message: string) {
  try {
    sessionStorage.setItem(CONSUMED_KEY, message);
  } catch {
    /* storage unavailable: the coach just opens empty */
  }
  go('coach');
}

function Chat({ onDataChanged }: { onDataChanged: () => void }) {
  const state = useApi<CoachState>('/coach');
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (state.data) setItems(state.data.messages);
  }, [state.data]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  useEffect(() => {
    if (prefilled.current || !state.data?.configured) return;
    prefilled.current = true;
    try {
      const msg = sessionStorage.getItem(CONSUMED_KEY);
      if (msg) {
        sessionStorage.removeItem(CONSUMED_KEY);
        void send(msg);
      }
    } catch {
      /* ignore */
    }
  }, [state.data]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    setInput('');
    const before = items;
    const reply: ChatItem = { role: 'assistant', text: '', actions: [] };
    let segments: string[] = [];
    let didSomething = false;
    const render = () => setItems([...before, { role: 'user', text: message, actions: [] }, { ...reply, text: segments.filter(Boolean).join('\n\n') }]);
    render();

    try {
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, today: todayISO(), tz: userTz() }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(chunk)?.[1];
          const dataLine = /^data: (.*)$/m.exec(chunk)?.[1];
          const data = dataLine ? JSON.parse(dataLine) : {};
          if (event === 'step') segments.push('');
          else if (event === 'text') {
            if (!segments.length) segments.push('');
            segments[segments.length - 1] += data.delta;
          } else if (event === 'retry') segments[segments.length - 1] = '';
          else if (event === 'action') {
            reply.actions = [...reply.actions, data.text];
            didSomething = true;
          } else if (event === 'info') setInfo(data.text);
          else if (event === 'error') throw new Error(data.message);
          render();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // If nothing came back the server dropped the turn; put the text back to retry.
      if (!segments.some(Boolean) && !reply.actions.length) {
        setItems(before);
        setInput(message);
      }
      segments = segments.filter(Boolean);
    } finally {
      setBusy(false);
      if (didSomething) onDataChanged();
    }
  }

  async function reset() {
    if (!confirm('Start a new conversation? Your goals, logs and coach notes stay.')) return;
    await post('/coach/reset');
    setItems([]);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  if (state.data && !state.data.configured) return <CoachSetup />;

  return (
    <div className="stack">
      {items.length === 0 && state.data && (
        <div className="card stack">
          <h2>Hi! I'm your coach.</h2>
          <p className="text-2">
            I can see your goals, weigh-ins, workouts, habits and today's calendar. Tell me your weight or a workout and I'll log it, ask for a plan that
            fits your week, or check in on how things are going.
          </p>
          <p className="small muted">
            Tip: fill in <a href="#/coach/goals">Goals</a> first so my advice fits you.
          </p>
        </div>
      )}

      <div className="chat" aria-live="polite">
        {items.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.actions.length > 0 && (
              <div className="actions">
                {m.actions.map((a, n) => (
                  <div key={n} className="action">
                    <Icon name="check" /> {a}
                  </div>
                ))}
              </div>
            )}
            {m.role === 'assistant' ? (
              m.text ? (
                <Markdown>{m.text}</Markdown>
              ) : (
                busy &&
                i === items.length - 1 && (
                  <span className="typing" aria-label="Coach is typing">
                    <i />
                    <i />
                    <i />
                  </span>
                )
              )
            ) : (
              m.text
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {info && <div className="banner info">{info}</div>}
      {error && <div className="banner bad">{error}</div>}

      {!busy && (
        <div className="prompts">
          {PROMPTS.map((p) => (
            <button key={p} onClick={() => send(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder="Message your coach… e.g. “Weighed 172.4 today”" aria-label="Message" />
        <button className="btn primary" disabled={busy || !input.trim()} aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>
      {items.length > 0 && (
        <div className="center">
          <button className="link-btn" onClick={reset} disabled={busy}>
            Start a new conversation
          </button>
        </div>
      )}
    </div>
  );
}

function CoachSetup() {
  const info = useAppInfo();
  return (
    <div className="card stack">
      <h2>Turn on your AI coach</h2>
      <p className="text-2">The coach runs on Claude. It needs an Anthropic API key, which you add once.</p>
      <ol className="steps">
        <li>
          Create a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
        </li>
        <li>
          Add it as <code>ANTHROPIC_API_KEY</code> in {settingsPlace(info?.hosted)}.
        </li>
        <li>Reload this page.</li>
      </ol>
      <p className="small muted">Progress and Goals work without the coach.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Progress

type SetHealth = (h: HealthState) => void;

function Progress({ health, setHealth }: { health: HealthState; setHealth: SetHealth }) {
  const today = useToday(todayISO);
  const { profile, weights, workouts } = health;
  const u = profile.units;
  const s = weightStats(weights, profile, today);
  const [range, setRange] = useState<'30' | '90' | 'all'>('90');
  const [wDate, setWDate] = useState(today);
  const [wValue, setWValue] = useState('');
  const [error, setError] = useState('');
  const [workout, setWorkout] = useState({ date: today, activity: '', minutes: '30', notes: '' });

  const weekChange = s.avg7 !== undefined && s.avgPrev7 !== undefined ? s.avg7 - s.avgPrev7 : undefined;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${round1(n)}`;

  async function logWeight(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setHealth(await post<HealthState>('/health/weights', { date: wDate, weight: Number(wValue) }));
      setWValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function logWorkout(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setHealth(await post<HealthState>('/health/workouts', { ...workout, minutes: Number(workout.minutes) }));
      setWorkout({ ...workout, activity: '', notes: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const recentWorkouts = [...workouts].reverse().slice(0, 12);
  const weekMinutes = workouts.filter((w) => w.date > addDays(today, -7)).reduce((n, w) => n + w.minutes, 0);

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <div className="label">7-day average</div>
          <div className="value">{s.avg7 !== undefined ? round1(s.avg7) : '–'}</div>
          <div className="delta">{weekChange !== undefined ? `${signed(weekChange)} ${u} vs last week` : u}</div>
        </div>
        <div className="stat">
          <div className="label">To goal</div>
          <div className="value">{s.toGo !== undefined ? round1(Math.max(0, s.toGo)) : '–'}</div>
          <div className="delta">{s.progressPct !== undefined ? `${Math.round(s.progressPct)}% of the way` : profile.goalWeight ? u : 'Set a goal'}</div>
        </div>
        <div className="stat">
          <div className="label">Trend</div>
          <div className="value">{s.weeklyTrend !== undefined ? signed(s.weeklyTrend) : '–'}</div>
          <div className="delta">{s.neededPerWeek !== undefined ? `${u}/wk · need ${signed(-s.neededPerWeek)}` : `${u} per week`}</div>
        </div>
        <div className="stat">
          <div className="label">Exercise, 7 days</div>
          <div className="value">{weekMinutes}</div>
          <div className="delta">minutes</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Weight</h2>
          <div className="seg">
            {(['30', '90', 'all'] as const).map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
        </div>
        <WeightChart weights={weights} goal={profile.goalWeight} units={u} from={range === 'all' ? undefined : addDays(today, -Number(range))} />
        <form className="row" style={{ marginTop: 14, alignItems: 'flex-end' }} onSubmit={logWeight}>
          <label className="field" style={{ width: 150 }}>
            Date
            <input type="date" value={wDate} max={today} onChange={(e) => setWDate(e.target.value)} />
          </label>
          <label className="field grow">
            Weight ({u})
            <input type="number" inputMode="decimal" step="0.1" min="1" value={wValue} onChange={(e) => setWValue(e.target.value)} placeholder="e.g. 172.4" />
          </label>
          <button className="btn primary" disabled={!wValue}>
            Log
          </button>
        </form>
        {error && <div className="banner bad" style={{ marginTop: 10 }}>{error}</div>}
        {weights.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="small">All weigh-ins ({weights.length})</summary>
            {[...weights].reverse().map((w) => (
              <div key={w.date} className="list-row">
                <span className="grow">{formatShort(w.date)}</span>
                <strong>
                  {w.weight} {u}
                </strong>
                <button className="icon-btn" style={{ border: 0 }} aria-label={`Delete weigh-in on ${w.date}`} onClick={async () => setHealth(await del<HealthState>(`/health/weights/${w.date}`))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </details>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Workouts</h2>
        </div>
        <form className="stack" style={{ gap: 10 }} onSubmit={logWorkout}>
          <div className="form-grid">
            <label className="field">
              What did you do?
              <input type="text" list="activities" value={workout.activity} onChange={(e) => setWorkout({ ...workout, activity: e.target.value })} placeholder="Walk, strength, yoga…" />
              <datalist id="activities">
                {[...new Set([...workouts.map((w) => w.activity), 'Walk', 'Run', 'Strength training', 'Yoga', 'Pilates', 'Cycling', 'Swim', 'HIIT'])].map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field grow">
                Minutes
                <input type="number" inputMode="numeric" min="1" value={workout.minutes} onChange={(e) => setWorkout({ ...workout, minutes: e.target.value })} />
              </label>
              <label className="field grow">
                Date
                <input type="date" max={today} value={workout.date} onChange={(e) => setWorkout({ ...workout, date: e.target.value })} />
              </label>
            </div>
            <label className="field full">
              Notes
              <input type="text" value={workout.notes} onChange={(e) => setWorkout({ ...workout, notes: e.target.value })} placeholder="Optional: distance, weights, how it felt" />
            </label>
          </div>
          <div>
            <button className="btn primary" disabled={!workout.activity.trim() || !Number(workout.minutes)}>
              Log workout
            </button>
          </div>
        </form>
        {recentWorkouts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {recentWorkouts.map((w) => (
              <div key={w.id} className="list-row">
                <span className="muted small" style={{ width: 56 }}>
                  {formatShort(w.date)}
                </span>
                <span className="grow">
                  <strong>{w.activity}</strong> · {w.minutes} min
                  {w.notes && <span className="muted"> · {w.notes}</span>}
                </span>
                <button className="icon-btn" style={{ border: 0 }} aria-label="Delete workout" onClick={async () => setHealth(await del<HealthState>(`/health/workouts/${w.id}`))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Goals

function Goals({ health, setHealth }: { health: HealthState; setHealth: SetHealth }) {
  const [p, setP] = useState<HealthProfile>(health.profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const set = <K extends keyof HealthProfile>(k: K, v: HealthProfile[K]) => {
    setP({ ...p, [k]: v });
    setSaved(false);
  };
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      setHealth(await put<HealthState>('/health/profile', p));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={save}>
        <h2>Your goals</h2>
        <div className="form-grid">
          <label className="field">
            Units
            <select value={p.units} onChange={(e) => set('units', e.target.value as HealthProfile['units'])}>
              <option value="lb">Pounds (lb)</option>
              <option value="kg">Kilograms (kg)</option>
            </select>
          </label>
          <label className="field">
            First name
            <input type="text" value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            Starting weight
            <input type="number" inputMode="decimal" step="0.1" value={p.startWeight ?? ''} onChange={(e) => set('startWeight', num(e.target.value))} />
          </label>
          <label className="field">
            Goal weight
            <input type="number" inputMode="decimal" step="0.1" value={p.goalWeight ?? ''} onChange={(e) => set('goalWeight', num(e.target.value))} />
          </label>
          <label className="field">
            Target date
            <input type="date" value={p.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value || undefined)} />
          </label>
          <label className="field">
            Activity level
            <select value={p.activityLevel ?? ''} onChange={(e) => set('activityLevel', (e.target.value || undefined) as HealthProfile['activityLevel'])}>
              <option value="">Choose…</option>
              <option value="sedentary">Mostly sitting</option>
              <option value="light">Lightly active</option>
              <option value="moderate">Moderately active</option>
              <option value="active">Active</option>
              <option value="very_active">Very active</option>
            </select>
          </label>
          <label className="field">
            Age
            <input type="number" inputMode="numeric" value={p.age ?? ''} onChange={(e) => set('age', num(e.target.value))} />
          </label>
          <label className="field">
            Height
            <input type="text" value={p.height ?? ''} onChange={(e) => set('height', e.target.value)} placeholder={`e.g. 5'6"`} />
          </label>
          <label className="field">
            Sex (for calorie estimates)
            <select value={p.sex ?? ''} onChange={(e) => set('sex', (e.target.value || undefined) as HealthProfile['sex'])}>
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field full">
            Fitness goals
            <textarea value={p.fitnessGoals ?? ''} onChange={(e) => set('fitnessGoals', e.target.value)} placeholder="e.g. Run a 5K by spring, get stronger, more energy for market days" rows={2} />
          </label>
          <label className="field full">
            Food preferences
            <textarea value={p.dietaryNotes ?? ''} onChange={(e) => set('dietaryNotes', e.target.value)} placeholder="e.g. Vegetarian, hate meal prep, love Mexican food" rows={2} />
          </label>
          <label className="field full">
            Injuries or limitations
            <textarea value={p.limitations ?? ''} onChange={(e) => set('limitations', e.target.value)} placeholder="e.g. Bad left knee, no gym membership" rows={2} />
          </label>
        </div>
        {error && <div className="banner bad">{error}</div>}
        <div className="row">
          <button className="btn primary">Save goals</button>
          {saved && <span className="small" style={{ color: 'var(--good)' }}>Saved</span>}
        </div>
      </form>

      <section className="card">
        <div className="card-head">
          <h2>Coach notes</h2>
        </div>
        <p className="small muted" style={{ marginBottom: 8 }}>
          Things your coach remembers between conversations. It adds these as you chat; you can add or remove them too.
        </p>
        {health.notes.map((n) => (
          <div key={n.id} className="list-row">
            <span className="grow">{n.text}</span>
            <button className="icon-btn" style={{ border: 0 }} aria-label="Delete note" onClick={async () => setHealth(await del<HealthState>(`/health/notes/${n.id}`))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setHealth(await post<HealthState>('/health/notes', { text: note }));
            setNote('');
          }}
        >
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Market days are Saturdays — I'm on my feet all day" aria-label="New note" />
          <button className="btn" disabled={!note.trim()}>
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
