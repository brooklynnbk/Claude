// Grouping and ordering for the to-do list, shared by the To-do page and Today.

import type { ISODate, Todo } from './types.ts';

export interface TodoGroup {
  key: 'overdue' | 'today' | 'upcoming' | 'someday';
  label: string;
  items: Todo[];
}

/** Starred first, then by due date, then oldest first. */
export function compareTodos(a: Todo, b: Todo): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  const ad = a.dueDate ?? '9999-12-31';
  const bd = b.dueDate ?? '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt);
}

export function groupTodos(todos: Todo[], today: ISODate): { groups: TodoGroup[]; done: Todo[] } {
  const open = todos.filter((t) => !t.done).sort(compareTodos);
  const groups: TodoGroup[] = [
    { key: 'overdue', label: 'Overdue', items: open.filter((t) => t.dueDate && t.dueDate < today) },
    { key: 'today', label: 'Today', items: open.filter((t) => t.dueDate === today) },
    { key: 'upcoming', label: 'Upcoming', items: open.filter((t) => t.dueDate && t.dueDate > today) },
    { key: 'someday', label: 'Someday', items: open.filter((t) => !t.dueDate) },
  ];
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return { groups: groups.filter((g) => g.items.length), done };
}

/** What belongs on the Today screen: overdue first, then due today. */
export const dueNow = (todos: Todo[], today: ISODate) =>
  todos
    .filter((t) => !t.done && t.dueDate && t.dueDate <= today)
    .sort((a, b) => Number(a.dueDate === today) - Number(b.dueDate === today) || compareTodos(a, b));
