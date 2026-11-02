import { useState, type FormEvent } from 'react';
import { completion, currentStreak, isDone, isScheduled } from '../../shared/habits.ts';
import type { Habit, HabitsState, ISODate } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { del, patch, post } from '../lib/api.ts';
import { addDays, formatWeekdayNarrow, relativeDay, todayISO, weekDates } from '../lib/dates.ts';
import { useApi, useToday } from '../lib/useApi.ts';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function useHabits() {
  const res = useApi<HabitsState>('/habits');
  const toggle = async (habit: Habit, date: ISODate) => {
    if (!res.data) return;
    // Optimistic update so the check feels instant.
    const done = !isDone(res.data, habit.id, date);
    const log = { ...res.data.log, [date]: done ? [...(res.data.log[date] ?? []), habit.id] : (res.data.log[date] ?? []).filter((x) => x !== habit.id) };
    res.setData({ ...res.data, log });
    try {
      res.setData(await post<HabitsState>(`/habits/${habit.id}/toggle`, { date, done }));
    } catch (err) {
      res.setError(err instanceof Error ? err.message : String(err));
      void res.reload();
    }
  };
  return { ...res, toggle };
}

export function HabitCheck({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`check ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} aria-label={label}>
      <Icon name="check" />
    </button>
  );
}

export function HabitsPage() {
  const today = useToday(todayISO);
  const [date, setDate] = useState<ISODate>(today);
  const { data, setData, error, toggle } = useHabits();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = data?.habits.filter((h) => !h.archived) ?? [];
  const archived = data?.habits.filter((h) => h.archived) ?? [];
  const due = active.filter((h) => isScheduled(h, date) || isDone(data!, h.id, date));
  const doneCount = due.filter((h) => isDone(data!, h.id, date)).length;
  const week = weekDates(addDays(today, -6)); // rolling last 7 days

  return (
    <div className="stack">
      <PageHead title="Habits" sub={data && due.length ? `${doneCount} of ${due.length} done ${date === today ? 'today' : relativeDay(date, today).toLowerCase()}` : undefined}>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> Habit
        </button>
      </PageHead>

      {error && <div className="banner bad">{error}</div>}

      {adding && (
        <HabitForm
          onCancel={() => setAdding(false)}
          onSave={async (h) => {
            setData(await post<HabitsState>('/habits', { ...h, today }));
            setAdding(false);
          }}
        />
      )}

      <section className="card">
        <div className="card-head">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            <Icon name="left" />
          </button>
          <h2>{relativeDay(date, today)}</h2>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
            <Icon name="right" />
          </button>
        </div>
        {data && due.length > 0 && (
          <div className="bar" style={{ marginBottom: 6 }}>
            <span style={{ width: `${(doneCount / due.length) * 100}%` }} />
          </div>
        )}
        {data && !active.length && !adding && (
          <div className="empty">
            No habits yet. <button className="link-btn" onClick={() => setAdding(true)}>Add your first one</button>, or ask your coach to suggest some.
          </div>
        )}
        {data && active.length > 0 && !due.length && <div className="empty">Nothing scheduled for this day.</div>}
        {data &&
          due.map((h) => {
            const done = isDone(data, h.id, date);
            const streak = currentStreak(data, h, today);
            return editing === h.id ? (
              <HabitForm
                key={h.id}
                habit={h}
                onCancel={() => setEditing(null)}
                onSave={async (patchBody) => {
                  setData(await patch<HabitsState>(`/habits/${h.id}`, patchBody));
                  setEditing(null);
                }}
                onArchive={async () => {
                  setData(await patch<HabitsState>(`/habits/${h.id}`, { archived: true }));
                  setEditing(null);
                }}
              />
            ) : (
              <div key={h.id} className={`habit ${done ? 'done' : ''}`}>
                <span className="emoji" aria-hidden>
                  {h.emoji}
                </span>
                <div className="grow">
                  <div className="name">{h.name}</div>
                  <div className="streak">
                    {streak > 0 ? `🔥 ${streak} day streak` : 'Start a streak'}
                    {h.days.length > 0 && ` · ${h.days.map((d) => DAY_LABELS[d]).join(' ')}`}
                  </div>
                </div>
                <button className="icon-btn" style={{ border: 0 }} onClick={() => setEditing(h.id)} aria-label={`Edit ${h.name}`}>
                  <Icon name="edit" />
                </button>
                <HabitCheck on={done} onClick={() => toggle(h, date)} label={`${h.name} ${done ? 'done' : 'not done'}`} />
              </div>
            );
          })}
      </section>

      {data && active.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Last 7 days</h2>
            <span className="small muted">Tap to fill in</span>
          </div>
          <table className="grid-week">
            <thead>
              <tr>
                <th className="label" />
                {week.map((d) => (
                  <th key={d} className={d === today ? 'today' : ''}>
                    {formatWeekdayNarrow(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <tr key={h.id}>
                  <td className="label ellipsis" title={h.name}>
                    {h.emoji} {h.name}
                  </td>
                  {week.map((d) => {
                    const scheduled = isScheduled(h, d);
                    const done = isDone(data, h.id, d);
                    if (!scheduled && !done)
                      return (
                        <td key={d}>
                          <span className="cell off" aria-hidden>
                            ·
                          </span>
                        </td>
                      );
                    return (
                      <td key={d}>
                        <button className={`cell ${done ? 'on' : ''}`} onClick={() => toggle(h, d)} aria-label={`${h.name} on ${d}: ${done ? 'done' : 'not done'}`}>
                          {done && <Icon name="check" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 10 }}>
            Last 30 days:{' '}
            {active
              .map((h) => {
                const c = completion(data, h, today, 30);
                return `${h.emoji} ${c.scheduled ? Math.round((c.done / c.scheduled) * 100) : 0}%`;
              })
              .join('  ·  ')}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="card">
          <button className="link-btn" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Hide' : 'Show'} archived habits ({archived.length})
          </button>
          {showArchived &&
            archived.map((h) => (
              <div key={h.id} className="list-row">
                <span>{h.emoji}</span>
                <span className="grow">{h.name}</span>
                <button className="btn sm" onClick={async () => setData(await patch<HabitsState>(`/habits/${h.id}`, { archived: false }))}>
                  Restore
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (confirm(`Delete "${h.name}" and its history?`)) setData(await del<HabitsState>(`/habits/${h.id}`));
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

const EMOJI_IDEAS = ['💧', '🚶', '🏋️', '🥗', '🧘', '😴', '📚', '✍️', '🍎', '🚫🍬', '🧴', '🎨'];

function HabitForm({
  habit,
  onSave,
  onCancel,
  onArchive,
}: {
  habit?: Habit;
  onSave: (h: { name: string; emoji: string; days: number[] }) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => Promise<void>;
}) {
  const [name, setName] = useState(habit?.name ?? '');
  const [emoji, setEmoji] = useState(habit?.emoji ?? '💧');
  const [days, setDays] = useState<number[]>(habit?.days ?? []);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onSave({ name: name.trim(), emoji, days });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className={habit ? 'stack' : 'card stack'} style={habit ? { padding: '12px 0', borderBottom: '1px solid var(--border)' } : undefined} onSubmit={submit}>
      {!habit && <h2>New habit</h2>}
      <div className="row">
        <input type="text" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" style={{ width: 64, textAlign: 'center', fontSize: '1.3rem' }} />
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drink 8 glasses of water" aria-label="Habit name" autoFocus={!habit} />
      </div>
      <div className="row wrap" style={{ gap: 4 }}>
        {EMOJI_IDEAS.map((e) => (
          <button type="button" key={e} className="btn ghost sm" onClick={() => setEmoji(e)} aria-label={`Use ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div>
        <div className="small text-2" style={{ fontWeight: 600, marginBottom: 6 }}>
          Repeat on {days.length === 0 ? '(every day)' : ''}
        </div>
        <div className="daypick">
          {DAY_LABELS.map((l, i) => (
            <button
              type="button"
              key={i}
              className={days.includes(i) ? 'on' : ''}
              onClick={() => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])}
              aria-pressed={days.includes(i)}
              aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="banner bad">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={!name.trim()}>
          {habit ? 'Save' : 'Add habit'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        {onArchive && (
          <button type="button" className="btn ghost danger" style={{ marginLeft: 'auto' }} onClick={onArchive}>
            <Icon name="archive" size={16} /> Archive
          </button>
        )}
      </div>
    </form>
  );
}
