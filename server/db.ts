// A tiny JSON-file store. This is a single-person app, so one file on disk is
// plenty: everything is loaded into memory at start-up and written back
// atomically (write temp file, then rename) after each change.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CalendarSource, HabitsState, HealthState, Order } from '../shared/types.ts';

export interface Data {
  version: 1;
  habits: HabitsState;
  orders: Order[];
  health: HealthState;
  calendar: { sources: CalendarSource[] };
  /** Raw Claude API conversation for the coach (append-only; see coach.ts). */
  coach: { messages: BetaMessageParam[] };
}

export function emptyData(): Data {
  return {
    version: 1,
    habits: { habits: [], log: {} },
    orders: [],
    health: { profile: { units: 'lb' }, weights: [], workouts: [], notes: [] },
    calendar: { sources: [] },
    coach: { messages: [] },
  };
}

export class Store {
  data: Data;
  private file: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'db.json');
    this.data = this.load();
  }

  private load(): Data {
    if (!fs.existsSync(this.file)) return emptyData();
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Data>;
    // Merge over defaults so older files pick up new sections.
    const base = emptyData();
    return {
      ...base,
      ...raw,
      habits: { ...base.habits, ...raw.habits },
      health: { ...base.health, ...raw.health, profile: { ...base.health.profile, ...raw.health?.profile } },
      calendar: { ...base.calendar, ...raw.calendar },
      coach: { ...base.coach, ...raw.coach },
    } as Data;
  }

  save(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Run a mutation and persist it. */
  update<T>(fn: (d: Data) => T): T {
    const result = fn(this.data);
    this.save();
    return result;
  }
}

export const newId = (): string => randomUUID().slice(0, 8);
