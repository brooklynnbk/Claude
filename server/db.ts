// App data store. Everything lives in one JSON document, split into two parts so
// the (large, growing) coach transcript isn't re-saved on every habit tap:
//   main  – habits, orders, health, calendar links
//   coach – the Claude conversation
//
// Where the parts are saved is pluggable (see storage.ts): a JSON file on your
// own computer/server, or Netlify Blobs when hosted on Netlify. Remote backends
// use compare-and-swap writes; if someone else saved in between, the change is
// re-applied to the fresh data, so concurrent edits never overwrite each other.

import { randomUUID } from 'node:crypto';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CalendarSource, HabitsState, HealthState, Order } from '../shared/types.ts';
import type { Backend, Part, Seen } from './storage.ts';

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

/** Fill in any sections missing from older or partial data (e.g. a backup file). */
export function normalizeData(raw: Partial<Data> | null | undefined): Data {
  const base = emptyData();
  const r = raw ?? {};
  return {
    version: 1,
    habits: { ...base.habits, ...r.habits },
    orders: Array.isArray(r.orders) ? r.orders : [],
    health: { ...base.health, ...r.health, profile: { ...base.health.profile, ...r.health?.profile } },
    calendar: { ...base.calendar, ...r.calendar },
    coach: { ...base.coach, ...r.coach },
  };
}

function split(d: Data): Record<Part, unknown> {
  const { coach, ...main } = d;
  return { main, coach };
}

export class ConflictError extends Error {}

export class Store {
  data: Data = emptyData();
  private seen: Record<Part, Seen> = { main: { exists: false }, coach: { exists: false } };
  private loaded = false;

  constructor(private backend: Backend) {}

  /** Load the latest saved data. Cheap no-op for the local file backend after the first call. */
  async refresh(): Promise<void> {
    if (this.loaded && !this.backend.shared) return;
    const [main, coach] = await Promise.all([this.backend.read('main'), this.backend.read('coach')]);
    this.data = normalizeData({ ...(main.value as Partial<Data>), coach: coach.value as Data['coach'] });
    this.seen = {
      main: { exists: main.value != null, version: main.version },
      coach: { exists: coach.value != null, version: coach.version },
    };
    this.loaded = true;
  }

  /**
   * Apply a change and save it. `fn` may run more than once if another request
   * saved first, so it must look things up on the `d` it's given (not on objects
   * captured beforehand).
   */
  async update<T>(fn: (d: Data) => T): Promise<T> {
    if (!this.loaded) await this.refresh();
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = split(this.data);
      const beforeJson = { main: JSON.stringify(before.main), coach: JSON.stringify(before.coach) };
      const result = fn(this.data);
      const after = split(this.data);

      let conflict = false;
      for (const part of ['main', 'coach'] as Part[]) {
        if (JSON.stringify(after[part]) === beforeJson[part]) continue;
        const res = await this.backend.write(part, after[part], this.seen[part]);
        if (!res.ok) {
          conflict = true;
          break;
        }
        this.seen[part] = { exists: true, version: res.version };
      }
      if (!conflict) return result;
      // Someone else saved first: reload and re-apply on top of their change.
      this.loaded = false;
      await this.refresh();
    }
    throw new ConflictError('Too many simultaneous changes. Please try again.');
  }

  /** Replace everything, e.g. when restoring a backup. */
  async replaceAll(next: Data): Promise<void> {
    await this.update((d) => {
      Object.assign(d, structuredClone(next));
    });
  }
}

export const newId = (): string => randomUUID().slice(0, 8);
