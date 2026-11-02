// Weight-trend math shared by the coach context and the Progress screen.

import type { HealthProfile, ISODate, WeightEntry } from './types.ts';

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);

export interface WeightStats {
  latest?: WeightEntry;
  /** Average of weigh-ins in the last 7 days (today included). */
  avg7?: number;
  /** Average of weigh-ins 8–14 days ago. */
  avgPrev7?: number;
  /** Least-squares slope over the last 28 days, in units per week (negative = losing). */
  weeklyTrend?: number;
  start?: number;
  goal?: number;
  /** Remaining distance to goal from the 7-day average (or latest). */
  toGo?: number;
  /** Rate per week needed to hit the goal by the target date. */
  neededPerWeek?: number;
  /** 0–100, share of the start→goal distance covered. */
  progressPct?: number;
}

export function weightStats(weights: WeightEntry[], profile: HealthProfile, today: ISODate): WeightStats {
  const sorted = [...weights].filter((w) => w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const stats: WeightStats = {};
  if (!sorted.length && profile.goalWeight === undefined) return stats;

  stats.latest = sorted.at(-1);
  const age = (w: WeightEntry) => daysBetween(w.date, today);
  stats.avg7 = mean(sorted.filter((w) => age(w) < 7).map((w) => w.weight));
  stats.avgPrev7 = mean(sorted.filter((w) => age(w) >= 7 && age(w) < 14).map((w) => w.weight));

  const recent = sorted.filter((w) => age(w) < 28);
  if (recent.length >= 4 && daysBetween(recent[0].date, recent.at(-1)!.date) >= 7) {
    const xs = recent.map((w) => -age(w));
    const ys = recent.map((w) => w.weight);
    const mx = mean(xs)!;
    const my = mean(ys)!;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - mx) * (ys[i] - my);
      den += (x - mx) ** 2;
    });
    if (den > 0) stats.weeklyTrend = (num / den) * 7;
  }

  stats.start = profile.startWeight ?? sorted[0]?.weight;
  stats.goal = profile.goalWeight;
  const current = stats.avg7 ?? stats.latest?.weight;
  if (stats.goal !== undefined && current !== undefined) {
    stats.toGo = current - stats.goal;
    if (profile.targetDate && profile.targetDate > today) {
      const weeks = daysBetween(today, profile.targetDate) / 7;
      stats.neededPerWeek = stats.toGo / weeks;
    }
    if (stats.start !== undefined && stats.start !== stats.goal) {
      const pct = ((stats.start - current) / (stats.start - stats.goal)) * 100;
      stats.progressPct = Math.max(0, Math.min(100, pct));
    }
  }
  return stats;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
