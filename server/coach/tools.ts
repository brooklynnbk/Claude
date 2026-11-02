// Tools the health coach can use to write into the app. Each tool has a JSON
// schema for Claude and a Zod schema we validate against before running it.

import { z } from 'zod';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { HealthProfile, ISODate } from '../../shared/types.ts';
import { round1, weightStats } from '../../shared/health.ts';
import { newId, type Store } from '../db.ts';
import { isISODate } from '../lib/time.ts';

const isoDate = z.string().refine(isISODate, 'must be a date formatted YYYY-MM-DD');

const inputs = {
  log_weight: z.object({
    weight: z.number().positive().max(1500),
    date: isoDate.optional(),
  }),
  log_workout: z.object({
    activity: z.string().min(1).max(120),
    minutes: z.number().int().positive().max(1440),
    date: isoDate.optional(),
    notes: z.string().max(500).optional(),
  }),
  add_habit: z.object({
    name: z.string().min(1).max(80),
    emoji: z.string().max(8).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  }),
  remember: z.object({
    note: z.string().min(1).max(400),
  }),
  update_goals: z.object({
    goalWeight: z.number().positive().max(1500).optional(),
    targetDate: isoDate.optional(),
    startWeight: z.number().positive().max(1500).optional(),
    fitnessGoals: z.string().max(1000).optional(),
    dietaryNotes: z.string().max(1000).optional(),
    limitations: z.string().max(1000).optional(),
    activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
  }),
};

export type ToolName = keyof typeof inputs;

const dateProp = {
  type: 'string',
  description: "Date it happened, YYYY-MM-DD. Omit for today. Use the context's dates to resolve words like 'yesterday'.",
} as const;

export const TOOLS: BetaTool[] = [
  {
    name: 'log_weight',
    description:
      'Record a weigh-in. Call this whenever the user tells you their weight for a day (e.g. "172.4 this morning"). Use the units in their profile. Replaces any existing entry for that date.',
    input_schema: {
      type: 'object',
      properties: { weight: { type: 'number', description: 'Body weight in the profile units' }, date: dateProp },
      required: ['weight'],
    },
  },
  {
    name: 'log_workout',
    description:
      'Record exercise the user says they did (walks, runs, lifting, classes, sports). Do not log planned workouts, only completed ones.',
    input_schema: {
      type: 'object',
      properties: {
        activity: { type: 'string', description: 'Short name, e.g. "Strength – lower body", "Walk", "Pilates"' },
        minutes: { type: 'integer', description: 'Duration in minutes' },
        date: dateProp,
        notes: { type: 'string', description: 'Optional details: distance, weights, how it felt' },
      },
      required: ['activity', 'minutes'],
    },
  },
  {
    name: 'add_habit',
    description:
      "Add a daily habit to the user's habit tracker. Only call this after the user agrees to the habit (or asks you to add it). Keep names short and concrete, e.g. \"Walk 20 min\", \"Protein at breakfast\".",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        emoji: { type: 'string', description: 'One emoji that represents the habit' },
        days: {
          type: 'array',
          items: { type: 'integer', minimum: 0, maximum: 6 },
          description: 'Days of week it applies to, 0 = Sunday … 6 = Saturday. Omit for every day.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'remember',
    description:
      'Save a lasting fact that should shape future coaching: injuries, foods they love or avoid, schedule constraints, what has or has not worked, preferences about tone. Saved notes appear in your context in every future conversation. Do not save weigh-ins or workouts here.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'One concise sentence' } },
      required: ['note'],
    },
  },
  {
    name: 'update_goals',
    description:
      'Change the goals in the user\'s profile. Only call this when the user explicitly asks to set or change a goal (goal weight, target date, fitness goals, diet notes, limitations, activity level).',
    input_schema: {
      type: 'object',
      properties: {
        goalWeight: { type: 'number' },
        targetDate: { type: 'string', description: 'YYYY-MM-DD' },
        startWeight: { type: 'number' },
        fitnessGoals: { type: 'string' },
        dietaryNotes: { type: 'string' },
        limitations: { type: 'string' },
        activityLevel: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
      },
    },
  },
].map((t) => ({ ...t, eager_input_streaming: true }) as BetaTool);

export interface ToolContext {
  store: Store;
  today: ISODate;
}

export type ToolOutcome =
  | { ok: true; result: string; action: string }
  | { ok: false; error: string };

function shortDate(d: ISODate): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, day)),
  );
}

/** Human-readable line for the chat UI. Also used to re-render old transcripts. */
export function describeAction(name: string, input: unknown, units: string): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const when = typeof i.date === 'string' && isISODate(i.date) ? ` · ${shortDate(i.date)}` : '';
  switch (name) {
    case 'log_weight':
      return `Logged weigh-in: ${i.weight} ${units}${when}`;
    case 'log_workout':
      return `Logged workout: ${i.activity} (${i.minutes} min)${when}`;
    case 'add_habit':
      return `Added habit: ${i.emoji ? `${i.emoji} ` : ''}${i.name}`;
    case 'remember':
      return `Noted: ${i.note}`;
    case 'update_goals':
      return `Updated goals`;
    default:
      return name;
  }
}

export function runTool(name: string, rawInput: unknown, ctx: ToolContext): ToolOutcome {
  if (!(name in inputs)) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = inputs[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    // Shape follows the eager-input-streaming guidance: hand the raw input back so Claude can retry.
    return {
      ok: false,
      error: JSON.stringify({
        INVALID_JSON: JSON.stringify(rawInput),
        issues: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`),
      }),
    };
  }
  const { store, today } = ctx;
  const units = store.data.health.profile.units;
  const action = describeAction(name, parsed.data, units);

  switch (name as ToolName) {
    case 'log_weight': {
      const { weight, date = today } = parsed.data as z.infer<typeof inputs.log_weight>;
      if (date > today) return { ok: false, error: 'Cannot log a weigh-in for a future date.' };
      store.update((d) => {
        d.health.weights = d.health.weights.filter((w) => w.date !== date);
        d.health.weights.push({ date, weight: round1(weight) });
        d.health.weights.sort((a, b) => a.date.localeCompare(b.date));
      });
      const s = weightStats(store.data.health.weights, store.data.health.profile, today);
      const avg = s.avg7 !== undefined ? ` 7-day average is now ${round1(s.avg7)} ${units}.` : '';
      return { ok: true, result: `Saved ${round1(weight)} ${units} for ${date}.${avg}`, action };
    }
    case 'log_workout': {
      const w = parsed.data as z.infer<typeof inputs.log_workout>;
      const date = w.date ?? today;
      if (date > today) return { ok: false, error: 'Only log workouts that already happened.' };
      store.update((d) => {
        d.health.workouts.push({ id: newId(), date, activity: w.activity, minutes: w.minutes, notes: w.notes });
        d.health.workouts.sort((a, b) => a.date.localeCompare(b.date));
      });
      return { ok: true, result: `Saved ${w.activity}, ${w.minutes} min on ${date}.`, action };
    }
    case 'add_habit': {
      const h = parsed.data as z.infer<typeof inputs.add_habit>;
      const exists = store.data.habits.habits.find(
        (x) => !x.archived && x.name.trim().toLowerCase() === h.name.trim().toLowerCase(),
      );
      if (exists) return { ok: true, result: `The habit "${exists.name}" is already in their tracker.`, action: `Habit already tracked: ${exists.name}` };
      store.update((d) => {
        d.habits.habits.push({
          id: newId(),
          name: h.name.trim(),
          emoji: h.emoji?.trim() || '✅',
          days: [...new Set(h.days ?? [])].sort(),
          archived: false,
          createdAt: `${today}T00:00:00.000Z`,
        });
      });
      return { ok: true, result: `Added "${h.name}" to the habit tracker.`, action };
    }
    case 'remember': {
      const { note } = parsed.data as z.infer<typeof inputs.remember>;
      store.update((d) => {
        d.health.notes.push({ id: newId(), text: note.trim(), createdAt: new Date().toISOString() });
      });
      return { ok: true, result: 'Saved to coach notes.', action };
    }
    case 'update_goals': {
      const g = parsed.data as Partial<HealthProfile>;
      const changed = Object.entries(g).filter(([, v]) => v !== undefined);
      if (!changed.length) return { ok: false, error: 'No goal fields were provided.' };
      store.update((d) => {
        d.health.profile = { ...d.health.profile, ...Object.fromEntries(changed) };
      });
      return {
        ok: true,
        result: `Updated ${changed.map(([k]) => k).join(', ')}.`,
        action: `Updated goals: ${changed.map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}`,
      };
    }
  }
}
