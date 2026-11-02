// The coach's instructions (fixed for the life of a conversation, so the
// prompt cache stays warm) and the per-turn context snapshot (appended to the
// conversation as a mid-conversation system message, never edited later).

import type { CalendarEvent, ISODate } from '../../shared/types.ts';
import { completion, currentStreak, isScheduled, isDone } from '../../shared/habits.ts';
import { round1, weightStats } from '../../shared/health.ts';
import type { Store } from '../db.ts';
import { addDays, formatDateLong, formatTimeInZone, weekStart } from '../lib/time.ts';

export const SYSTEM_PROMPT = `You are a personal health coach built into the user's own all-in-one app ("HQ"). The app also holds their Apple Calendar, their daily habit tracker, and the weekly order queue for the sticker business they run, so you can see how full their days are.

Your job is to help them reach their weight and fitness goals with a plan they can keep up with on a busy week.

How to coach:
- Be warm, direct and practical. Default to short replies: a few sentences or a tight list. Go longer only when they ask for a plan or a breakdown.
- Ground advice in their data. Before each of their messages you get a context note with their profile, goals, recent weigh-ins, workouts, habit streaks, today's calendar and order load. Use specifics ("your 7-day average is down 1.2 lb since last week") instead of generic advice. If something important is missing (no goal weight, no weigh-ins yet), ask for it.
- Fit movement and food prep into the real calendar. Suggest concrete time slots around their events, and lighter plans on days packed with meetings or sticker orders.
- Favor small habits they can repeat. When a habit would help, suggest it; once they agree, add it to their tracker with the add_habit tool.
- Daily weight swings of a few pounds are normal (water, salt, sleep, cycle). Judge progress on the 7-day average and multi-week trend, never one weigh-in.
- Celebrate streaks and wins. Treat missed days as information, not failure, and never shame.

Logging: when they tell you a weigh-in, a finished workout, or a lasting fact that matters for coaching (an injury, foods they dislike, their work schedule), record it with the matching tool in the same turn, then confirm in a few words. Only log what they said actually happened. Use the dates in the context note to resolve "yesterday" or "this morning".

Safety:
- Aim for sustainable loss of about 0.5–1% of body weight per week. Don't recommend eating below roughly 1,200 kcal/day for women or 1,500 kcal/day for men, long fasts, or skipping meals to make up for eating.
- You are not a doctor. For chest pain, fainting, pain or injuries that aren't improving, pregnancy, eating disorders, diabetes or other conditions and medications, suggest they check with a clinician before changing their plan, and keep your suggestions conservative.
- If they describe signs of disordered eating (bingeing and purging, extreme restriction, exercising to "burn off" food, intense guilt about eating), respond with care, stop pushing weight loss, and encourage them to talk to a doctor or an eating-disorder helpline.

Formatting: plain conversational text. Use short bullet lists for plans. No tables or headings unless asked.`;

function fmtNum(n: number | undefined, units: string): string {
  return n === undefined ? 'unknown' : `${round1(n)} ${units}`;
}

function eventLine(e: CalendarEvent, tz: string): string {
  const when = e.allDay
    ? 'all day'
    : `${formatTimeInZone(new Date(e.start), tz)}–${formatTimeInZone(new Date(e.end), tz)}`;
  return `- ${when}: ${e.title}${e.location ? ` (${e.location})` : ''}`;
}

export function buildSnapshot(
  store: Store,
  today: ISODate,
  tz: string,
  now: Date,
  calendar: { events: CalendarEvent[]; error?: string },
): string {
  const { health, habits, orders } = store.data;
  const p = health.profile;
  const u = p.units;
  const lines: string[] = [];

  lines.push(`Context for this message (app data as of ${formatDateLong(today)}, ${formatTimeInZone(now, tz)}, time zone ${tz}). Yesterday was ${addDays(today, -1)}.`);

  // Profile & goals
  const profile = [
    p.name && `name ${p.name}`,
    p.age && `age ${p.age}`,
    p.sex && `sex ${p.sex}`,
    p.height && `height ${p.height}`,
    p.activityLevel && `activity level ${p.activityLevel.replace('_', ' ')}`,
  ].filter(Boolean);
  lines.push('', '## Profile', profile.length ? profile.join(', ') : 'Not filled in yet.');
  lines.push(`Units: ${u}`);
  lines.push(
    `Goal weight: ${p.goalWeight ? `${p.goalWeight} ${u}` : 'not set'}${p.targetDate ? ` by ${p.targetDate}` : ''}. Starting weight: ${p.startWeight ? `${p.startWeight} ${u}` : 'not set'}.`,
  );
  if (p.fitnessGoals) lines.push(`Fitness goals: ${p.fitnessGoals}`);
  if (p.dietaryNotes) lines.push(`Food preferences: ${p.dietaryNotes}`);
  if (p.limitations) lines.push(`Injuries / limitations: ${p.limitations}`);

  if (health.notes.length) {
    lines.push('', '## Your saved coach notes');
    for (const n of health.notes.slice(-30)) lines.push(`- ${n.text}`);
  }

  // Weight
  const s = weightStats(health.weights, p, today);
  const recentWeights = health.weights.filter((w) => w.date > addDays(today, -21) && w.date <= today);
  lines.push('', '## Weight');
  if (!health.weights.length) {
    lines.push('No weigh-ins logged yet.');
  } else {
    lines.push(
      `Latest: ${fmtNum(s.latest?.weight, u)} on ${s.latest?.date}. 7-day avg: ${fmtNum(s.avg7, u)}. Previous 7-day avg: ${fmtNum(s.avgPrev7, u)}.`,
    );
    if (s.weeklyTrend !== undefined) lines.push(`28-day trend: ${s.weeklyTrend > 0 ? '+' : ''}${round1(s.weeklyTrend)} ${u}/week.`);
    if (s.toGo !== undefined) lines.push(`To goal: ${round1(s.toGo)} ${u}.`);
    if (s.neededPerWeek !== undefined) lines.push(`Pace needed for target date: ${round1(s.neededPerWeek)} ${u}/week.`);
    if (recentWeights.length) lines.push(`Last 3 weeks: ${recentWeights.map((w) => `${w.date.slice(5)} ${w.weight}`).join(', ')}`);
  }

  // Workouts
  const recentWorkouts = health.workouts.filter((w) => w.date > addDays(today, -14) && w.date <= today);
  lines.push('', '## Workouts (last 14 days)');
  if (!recentWorkouts.length) lines.push('None logged.');
  for (const w of recentWorkouts) lines.push(`- ${w.date}: ${w.activity}, ${w.minutes} min${w.notes ? ` — ${w.notes}` : ''}`);

  // Habits
  const active = habits.habits.filter((h) => !h.archived);
  lines.push('', '## Habits');
  if (!active.length) lines.push('No habits in the tracker yet.');
  for (const h of active) {
    const c = completion(habits, h, today, 7);
    const today_ = isScheduled(h, today) ? (isDone(habits, h.id, today) ? 'done today' : 'not done yet today') : 'not scheduled today';
    lines.push(`- ${h.emoji} ${h.name}: ${c.done}/${c.scheduled} in last 7 days, streak ${currentStreak(habits, h, today)}, ${today_}`);
  }

  // Calendar
  lines.push('', "## Today's calendar");
  if (calendar.error) lines.push(`Unavailable (${calendar.error}).`);
  else if (!calendar.events.length) lines.push('Nothing scheduled.');
  for (const e of calendar.events) lines.push(eventLine(e, tz));

  // Orders
  const ws = weekStart(today);
  const we = addDays(ws, 7);
  const open = orders.filter((o) => o.status !== 'shipped');
  const thisWeek = orders.filter((o) => o.dueDate >= ws && o.dueDate < we);
  const overdue = open.filter((o) => o.dueDate < today);
  const dueToday = open.filter((o) => o.dueDate === today);
  const stickers = thisWeek.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);
  lines.push('', '## Sticker business workload');
  lines.push(
    `This week: ${thisWeek.length} orders (${thisWeek.filter((o) => o.status === 'shipped').length} shipped), ${stickers} stickers. Due today and not shipped: ${dueToday.length}. Overdue: ${overdue.length}.`,
  );

  return lines.join('\n');
}
