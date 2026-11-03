import { useState, type FormEvent } from 'react';
import { groupTodos } from '../../shared/todos.ts';
import type { ISODate, Todo } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { del, patch, post } from '../lib/api.ts';
import { addDays, relativeDay, todayISO } from '../lib/dates.ts';
import { useApi, useToday } from '../lib/useApi.ts';

type TodoInput = { title: string; dueDate?: ISODate | null; notes?: string; starred?: boolean };

export function useTodos() {
  const res = useApi<Todo[]>('/todos');
  const run = async (p: Promise<Todo[]>) => {
    try {
      res.setData(await p);
      res.setError(undefined);
    } catch (err) {
      res.setError(err instanceof Error ? err.message : String(err));
      void res.reload();
    }
  };
  const update = (t: Todo, body: Partial<TodoInput> & { done?: boolean }) => {
    // Optimistic so checking things off feels instant.
    res.setData((list) => list?.map((x) => (x.id === t.id ? { ...x, ...body, dueDate: body.dueDate === null ? undefined : (body.dueDate ?? x.dueDate) } : x)));
    return run(patch<Todo[]>(`/todos/${t.id}`, body));
  };
  return {
    ...res,
    add: (body: TodoInput) => run(post<Todo[]>('/todos', body)),
    update,
    toggle: (t: Todo) => update(t, { done: !t.done }),
    star: (t: Todo) => update(t, { starred: !t.starred }),
    remove: (t: Todo) => run(del<Todo[]>(`/todos/${t.id}`)),
    clearDone: () => run(post<Todo[]>('/todos/clear-completed')),
  };
}

type Todos = ReturnType<typeof useTodos>;

/** Due-date picker: No date / Today / Tomorrow / any date. */
function DuePicker({ value, onChange, today }: { value: ISODate | ''; onChange: (v: ISODate | '') => void; today: ISODate }) {
  const tomorrow = addDays(today, 1);
  const custom = value && value !== today && value !== tomorrow;
  return (
    <div className="due-chips" role="group" aria-label="Due date">
      {(
        [
          ['', 'No date'],
          [today, 'Today'],
          [tomorrow, 'Tomorrow'],
        ] as const
      ).map(([v, label]) => (
        <button type="button" key={label} className={value === v ? 'on' : ''} onClick={() => onChange(v)} aria-pressed={value === v}>
          {label}
        </button>
      ))}
      <label className={`date-chip ${custom ? 'on' : ''}`}>
        <Icon name="calendar" size={14} />
        {custom ? relativeDay(value, today) : 'Pick date'}
        {/* Invisible native date input over the chip: opens the phone's date picker. */}
        <input
          type="date"
          value={custom ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              /* older browsers: the tap already focuses the field */
            }
          }}
          aria-label="Pick a date"
        />
      </label>
    </div>
  );
}

export function QuickAdd({ todos, today, defaultDue = '', compact = false }: { todos: Todos; today: ISODate; defaultDue?: ISODate | ''; compact?: boolean }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<ISODate | ''>(defaultDue);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await todos.add({ title: title.trim(), dueDate: due || undefined });
    setTitle('');
    setBusy(false);
  }

  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
      <div className="row">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={compact ? 'Add a to-do for today…' : 'Add a to-do…'}
          aria-label="New to-do"
          enterKeyHint="done"
        />
        <button className="btn primary" disabled={busy || !title.trim()} aria-label="Add to-do">
          <Icon name="plus" size={18} />
        </button>
      </div>
      {!compact && <DuePicker value={due} onChange={setDue} today={today} />}
    </form>
  );
}

function dueChip(t: Todo, today: ISODate) {
  if (!t.dueDate) return null;
  const late = !t.done && t.dueDate < today;
  return <span className={`chip ${late ? 'bad' : t.dueDate === today ? 'accent' : ''}`}>{relativeDay(t.dueDate, today)}</span>;
}

export function TodoRow({ t, todos, today, showDue = true }: { t: Todo; todos: Todos; today: ISODate; showDue?: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <TodoEditor t={t} todos={todos} today={today} onClose={() => setEditing(false)} />;
  return (
    <div className={`todo ${t.done ? 'done' : ''}`}>
      <button className={`check ${t.done ? 'on' : ''}`} onClick={() => todos.toggle(t)} aria-pressed={t.done} aria-label={`${t.title}: ${t.done ? 'done' : 'not done'}`}>
        <Icon name="check" />
      </button>
      <div className="grow">
        <button className="todo-title" onClick={() => setEditing(true)} aria-label={`Edit ${t.title}`}>
          {t.title}
        </button>
        {((showDue && t.dueDate) || t.notes) && (
          <div className="todo-meta">
            {showDue && dueChip(t, today)}
            {t.notes && <span className="small muted ellipsis" style={{ maxWidth: '100%' }}>{t.notes}</span>}
          </div>
        )}
      </div>
      {!t.done && (
        <button className={`star-btn ${t.starred ? 'on' : ''}`} onClick={() => todos.star(t)} aria-pressed={t.starred} aria-label={t.starred ? 'Unstar' : 'Star as important'}>
          <Icon name="star" filled={t.starred} />
        </button>
      )}
    </div>
  );
}

function TodoEditor({ t, todos, today, onClose }: { t: Todo; todos: Todos; today: ISODate; onClose: () => void }) {
  const [title, setTitle] = useState(t.title);
  const [due, setDue] = useState<ISODate | ''>(t.dueDate ?? '');
  const [notes, setNotes] = useState(t.notes ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await todos.update(t, { title: title.trim(), dueDate: due || null, notes: notes.trim() });
    onClose();
  }

  return (
    <form className="stack" style={{ gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }} onSubmit={save}>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="To-do" autoFocus />
      <DuePicker value={due} onChange={setDue} today={today} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} aria-label="Notes" />
      <div className="row">
        <button className="btn primary" disabled={!title.trim()}>
          Save
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn ghost danger"
          style={{ marginLeft: 'auto' }}
          onClick={async () => {
            await todos.remove(t);
            onClose();
          }}
        >
          <Icon name="trash" size={16} /> Delete
        </button>
      </div>
    </form>
  );
}

export function TodosPage() {
  const today = useToday(todayISO);
  const todos = useTodos();
  const [showDone, setShowDone] = useState(false);
  const { groups, done } = groupTodos(todos.data ?? [], today);
  const dueToday = groups.filter((g) => g.key === 'overdue' || g.key === 'today').reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="stack">
      <PageHead title="To-do" sub={todos.data ? (dueToday ? `${dueToday} due today` : 'Nothing due today') : undefined} />

      <section className="card">
        <QuickAdd todos={todos} today={today} />
      </section>

      {todos.error && <div className="banner bad">{todos.error}</div>}

      {todos.data && !groups.length && (
        <section className="card">
          <div className="empty">{done.length ? 'All done. 🎉' : 'Nothing on your list yet. Add your first to-do above.'}</div>
        </section>
      )}

      {groups.length > 0 && (
        <section className="card">
          {groups.map((g) => (
            <div key={g.key} style={{ marginBottom: 6 }}>
              <div className={`group-title ${g.key === 'overdue' ? 'bad' : g.key === 'today' ? 'today' : ''}`}>
                {g.label} <span className="muted">· {g.items.length}</span>
              </div>
              {g.items.map((t) => (
                <TodoRow key={t.id} t={t} todos={todos} today={today} showDue={g.key !== 'today' && g.key !== 'someday'} />
              ))}
            </div>
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="card">
          <div className="spread">
            <button className="link-btn" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide' : 'Show'} completed ({done.length})
            </button>
            <button
              className="link-btn"
              style={{ color: 'var(--bad)' }}
              onClick={() => {
                if (confirm(`Delete ${done.length} completed to-do${done.length === 1 ? '' : 's'}?`)) void todos.clearDone();
              }}
            >
              Clear completed
            </button>
          </div>
          {showDone && done.map((t) => <TodoRow key={t.id} t={t} todos={todos} today={today} />)}
        </section>
      )}
    </div>
  );
}
