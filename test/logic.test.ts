import { describe, expect, it } from 'vitest';
import { completion, currentStreak } from '../shared/habits.ts';
import { weightStats } from '../shared/health.ts';
import type { Habit, HabitsState } from '../shared/types.ts';
import { weekStart } from '../server/lib/time.ts';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Water',
  emoji: '💧',
  days: [],
  archived: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('habit streaks', () => {
  const state: HabitsState = {
    habits: [],
    log: {
      '2026-10-29': ['h1'],
      '2026-10-30': ['h1'],
      '2026-10-31': ['h1'],
      '2026-11-01': ['h1'],
    },
  };

  it("doesn't break the streak just because today isn't done yet", () => {
    expect(currentStreak(state, habit(), '2026-11-02')).toBe(4);
  });

  it('breaks on a missed scheduled day', () => {
    expect(currentStreak(state, habit(), '2026-11-03')).toBe(0);
  });

  it('skips days the habit is not scheduled', () => {
    // Weekdays only: Thu Oct 29, Fri Oct 30 done; Sat/Sun skipped; Mon Nov 2 not yet done
    const weekdays = habit({ days: [1, 2, 3, 4, 5] });
    expect(currentStreak(state, weekdays, '2026-11-02')).toBe(2);
    expect(completion(state, weekdays, '2026-11-02', 7)).toEqual({ done: 2, scheduled: 5 });
  });
});

describe('weightStats', () => {
  it('computes averages, trend and pace', () => {
    const weights = [
      { date: '2026-10-06', weight: 180 },
      { date: '2026-10-13', weight: 179 },
      { date: '2026-10-20', weight: 178 },
      { date: '2026-10-27', weight: 177 },
      { date: '2026-11-01', weight: 176.4 },
      { date: '2026-11-02', weight: 175.6 },
    ];
    const s = weightStats(weights, { units: 'lb', goalWeight: 160, startWeight: 180, targetDate: '2027-02-22' }, '2026-11-02');
    expect(s.latest).toEqual({ date: '2026-11-02', weight: 175.6 });
    expect(s.avg7).toBeCloseTo((177 + 176.4 + 175.6) / 3);
    expect(s.weeklyTrend).toBeLessThan(-0.9);
    expect(s.weeklyTrend).toBeGreaterThan(-1.3);
    expect(s.toGo).toBeCloseTo(s.avg7! - 160);
    expect(s.neededPerWeek).toBeCloseTo(s.toGo! / 16);
    expect(s.progressPct).toBeGreaterThan(10);
  });
});

describe('weekStart', () => {
  it('returns Monday', () => {
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-04')).toBe('2026-11-02');
  });
});

describe('to-do grouping', async () => {
  const { groupTodos, dueNow } = await import('../shared/todos.ts');
  const t = (id: string, over: Partial<import('../shared/types.ts').Todo> = {}) => ({
    id,
    title: id,
    starred: false,
    done: false,
    createdAt: `2026-11-01T00:00:0${id.length}Z`,
    ...over,
  });
  const list = [
    t('someday'),
    t('late', { dueDate: '2026-10-30' }),
    t('today-b', { dueDate: '2026-11-02' }),
    t('today-star', { dueDate: '2026-11-02', starred: true }),
    t('next-week', { dueDate: '2026-11-09' }),
    t('finished', { dueDate: '2026-11-02', done: true, doneAt: '2026-11-02T10:00:00Z' }),
  ];

  it('groups into overdue, today, upcoming and someday with starred first', () => {
    const { groups, done } = groupTodos(list, '2026-11-02');
    expect(groups.map((g) => [g.key, g.items.map((x) => x.id)])).toEqual([
      ['overdue', ['late']],
      ['today', ['today-star', 'today-b']],
      ['upcoming', ['next-week']],
      ['someday', ['someday']],
    ]);
    expect(done.map((x) => x.id)).toEqual(['finished']);
  });

  it('shows overdue and today on the Today screen', () => {
    expect(dueNow(list, '2026-11-02').map((x) => x.id)).toEqual(['late', 'today-star', 'today-b']);
  });
});
