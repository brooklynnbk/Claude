// Habit scheduling and streak math, shared by the server (coach context) and the UI.

import type { Habit, HabitsState, ISODate } from './types.ts';

function shiftDate(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}

function weekday(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

export function isScheduled(habit: Habit, date: ISODate): boolean {
  if (date < habit.createdAt.slice(0, 10)) return false;
  return habit.days.length === 0 || habit.days.includes(weekday(date));
}

export function isDone(state: HabitsState, habitId: string, date: ISODate): boolean {
  return state.log[date]?.includes(habitId) ?? false;
}

/**
 * Consecutive scheduled days completed, counting back from `today`.
 * If today isn't checked off yet it doesn't break the streak — the day isn't over.
 */
export function currentStreak(state: HabitsState, habit: Habit, today: ISODate): number {
  let streak = 0;
  let d = today;
  const created = habit.createdAt.slice(0, 10);
  for (let i = 0; i < 3660 && d >= created; i++, d = shiftDate(d, -1)) {
    if (!isScheduled(habit, d)) continue;
    if (isDone(state, habit.id, d)) streak++;
    else if (d !== today) break;
  }
  return streak;
}

/** Completed / scheduled counts over the `days` days ending on `today`. */
export function completion(state: HabitsState, habit: Habit, today: ISODate, days: number): { done: number; scheduled: number } {
  let done = 0;
  let scheduled = 0;
  for (let i = 0; i < days; i++) {
    const d = shiftDate(today, -i);
    if (!isScheduled(habit, d)) continue;
    scheduled++;
    if (isDone(state, habit.id, d)) done++;
  }
  return { done, scheduled };
}
