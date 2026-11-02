import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ORDER_STATUSES, type CalendarResponse, type CoachState } from '../shared/types.ts';
import { mountAuthRoutes, requireAuth } from './auth.ts';
import { loadEvents, normalizeCalendarUrl } from './calendar/sources.ts';
import { sortEvents } from './calendar/ics.ts';
import { CoachDeclinedError, runCoachTurn, toChatItems, type CoachEvent } from './coach/coach.ts';
import { config } from './config.ts';
import { newId, type Store } from './db.ts';
import { addDays, isISODate, isValidTimeZone, zonedRange } from './lib/time.ts';

export interface AppDeps {
  store: Store;
  /** Injected in tests; otherwise created on first use from ANTHROPIC_API_KEY. */
  anthropic?: Pick<Anthropic, 'beta'>;
}

const isoDate = z.string().refine(isISODate, 'Use a YYYY-MM-DD date');
const optText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined));

const habitInput = z.object({
  name: z.string().trim().min(1).max(80),
  emoji: z.string().trim().max(8).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const orderInput = z.object({
  customer: z.string().trim().min(1).max(120),
  channel: optText(60),
  items: z
    .array(
      z.object({
        design: z.string().trim().min(1).max(120),
        quantity: z.number().int().min(1).max(100000),
        size: optText(60),
      }),
    )
    .min(1)
    .max(100),
  dueDate: isoDate,
  status: z.enum(ORDER_STATUSES).default('todo'),
  // null clears the total when editing
  total: z.number().min(0).max(1_000_000).nullish().transform((v) => v ?? undefined),
  notes: optText(2000),
});

const profileInput = z.object({
  name: optText(80),
  units: z.enum(['lb', 'kg']),
  age: z.number().int().min(10).max(120).optional(),
  sex: z.enum(['female', 'male', 'other']).optional(),
  height: optText(40),
  startWeight: z.number().positive().max(1500).optional(),
  goalWeight: z.number().positive().max(1500).optional(),
  targetDate: isoDate.optional(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional(),
  fitnessGoals: optText(1000),
  dietaryNotes: optText(1000),
  limitations: optText(1000),
});

const sourceInput = z.object({
  name: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .refine((u) => /^(https?|webcals?):\/\//i.test(u), 'Paste a link starting with webcal:// or https://'),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#1c7ed6'),
});

function parse<T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  res.status(400).json({ error: r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
  return undefined;
}

const param = (req: Request, name: string) => String(req.params[name]);

export function createApp({ store, anthropic }: AppDeps) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  mountAuthRoutes(api);
  api.use(requireAuth);

  // ---------- Habits ----------
  api.get('/habits', (_req, res) => {
    res.json(store.data.habits);
  });

  api.post('/habits', (req, res) => {
    const h = parse(habitInput.extend({ today: isoDate.optional() }), req.body, res);
    if (!h) return;
    store.update((d) => {
      d.habits.habits.push({
        id: newId(),
        name: h.name,
        emoji: h.emoji || '✅',
        days: [...new Set(h.days ?? [])].sort(),
        archived: false,
        // Anchor to the user's local date so the habit counts from "today" in their zone.
        createdAt: h.today ? `${h.today}T00:00:00.000Z` : new Date().toISOString(),
      });
    });
    res.json(store.data.habits);
  });

  api.patch('/habits/:id', (req, res) => {
    const patch = parse(habitInput.partial().extend({ archived: z.boolean().optional() }), req.body, res);
    if (!patch) return;
    const habit = store.data.habits.habits.find((h) => h.id === param(req, 'id'));
    if (!habit) return void res.status(404).json({ error: 'Habit not found' });
    store.update(() => {
      if (patch.name !== undefined) habit.name = patch.name;
      if (patch.emoji !== undefined) habit.emoji = patch.emoji || '✅';
      if (patch.days !== undefined) habit.days = [...new Set(patch.days)].sort();
      if (patch.archived !== undefined) habit.archived = patch.archived;
    });
    res.json(store.data.habits);
  });

  api.delete('/habits/:id', (req, res) => {
    const id = param(req, 'id');
    store.update((d) => {
      d.habits.habits = d.habits.habits.filter((h) => h.id !== id);
      for (const [date, ids] of Object.entries(d.habits.log)) {
        const left = ids.filter((x) => x !== id);
        if (left.length) d.habits.log[date] = left;
        else delete d.habits.log[date];
      }
    });
    res.json(store.data.habits);
  });

  api.post('/habits/:id/toggle', (req, res) => {
    const body = parse(z.object({ date: isoDate, done: z.boolean().optional() }), req.body, res);
    if (!body) return;
    const id = param(req, 'id');
    if (!store.data.habits.habits.some((h) => h.id === id)) return void res.status(404).json({ error: 'Habit not found' });
    store.update((d) => {
      const day = new Set(d.habits.log[body.date] ?? []);
      const done = body.done ?? !day.has(id);
      if (done) day.add(id);
      else day.delete(id);
      if (day.size) d.habits.log[body.date] = [...day];
      else delete d.habits.log[body.date];
    });
    res.json(store.data.habits);
  });

  // ---------- Orders ----------
  api.get('/orders', (_req, res) => {
    res.json(store.data.orders);
  });

  api.post('/orders', (req, res) => {
    const o = parse(orderInput, req.body, res);
    if (!o) return;
    const order = {
      id: newId(),
      ...o,
      createdAt: new Date().toISOString(),
      completedAt: o.status === 'shipped' ? new Date().toISOString() : undefined,
    };
    store.update((d) => d.orders.push(order));
    res.json(order);
  });

  api.patch('/orders/:id', (req, res) => {
    const patch = parse(orderInput.partial(), req.body, res);
    if (!patch) return;
    const order = store.data.orders.find((o) => o.id === param(req, 'id'));
    if (!order) return void res.status(404).json({ error: 'Order not found' });
    store.update(() => {
      // Only fields present in the request body change; sending a key as null/"" clears optional text.
      for (const key of Object.keys(req.body ?? {}) as (keyof typeof patch)[]) {
        if (key in patch) Object.assign(order, { [key]: patch[key] });
      }
      if (order.status === 'shipped') order.completedAt ??= new Date().toISOString();
      else delete order.completedAt;
    });
    res.json(order);
  });

  api.delete('/orders/:id', (req, res) => {
    const id = param(req, 'id');
    store.update((d) => {
      d.orders = d.orders.filter((o) => o.id !== id);
    });
    res.json({ ok: true });
  });

  // ---------- Health ----------
  api.get('/health', (_req, res) => {
    res.json(store.data.health);
  });

  api.put('/health/profile', (req, res) => {
    const p = parse(profileInput, req.body, res);
    if (!p) return;
    store.update((d) => {
      d.health.profile = p;
    });
    res.json(store.data.health);
  });

  api.post('/health/weights', (req, res) => {
    const w = parse(z.object({ date: isoDate, weight: z.number().positive().max(1500) }), req.body, res);
    if (!w) return;
    store.update((d) => {
      d.health.weights = d.health.weights.filter((x) => x.date !== w.date);
      d.health.weights.push({ date: w.date, weight: Math.round(w.weight * 10) / 10 });
      d.health.weights.sort((a, b) => a.date.localeCompare(b.date));
    });
    res.json(store.data.health);
  });

  api.delete('/health/weights/:date', (req, res) => {
    const date = param(req, 'date');
    store.update((d) => {
      d.health.weights = d.health.weights.filter((w) => w.date !== date);
    });
    res.json(store.data.health);
  });

  api.post('/health/workouts', (req, res) => {
    const w = parse(
      z.object({
        date: isoDate,
        activity: z.string().trim().min(1).max(120),
        minutes: z.number().int().min(1).max(1440),
        notes: optText(500),
      }),
      req.body,
      res,
    );
    if (!w) return;
    store.update((d) => {
      d.health.workouts.push({ id: newId(), ...w });
      d.health.workouts.sort((a, b) => a.date.localeCompare(b.date));
    });
    res.json(store.data.health);
  });

  api.delete('/health/workouts/:id', (req, res) => {
    const id = param(req, 'id');
    store.update((d) => {
      d.health.workouts = d.health.workouts.filter((w) => w.id !== id);
    });
    res.json(store.data.health);
  });

  api.post('/health/notes', (req, res) => {
    const n = parse(z.object({ text: z.string().trim().min(1).max(400) }), req.body, res);
    if (!n) return;
    store.update((d) => {
      d.health.notes.push({ id: newId(), text: n.text, createdAt: new Date().toISOString() });
    });
    res.json(store.data.health);
  });

  api.delete('/health/notes/:id', (req, res) => {
    const id = param(req, 'id');
    store.update((d) => {
      d.health.notes = d.health.notes.filter((n) => n.id !== id);
    });
    res.json(store.data.health);
  });

  // ---------- Calendar ----------
  const rangeQuery = (startDate: string, endDate: string, tz: string) => ({
    startDate,
    endDate,
    userTz: tz,
    ...(({ start, end }) => ({ rangeStart: start, rangeEnd: end }))(zonedRange(startDate, endDate, tz)),
  });

  api.get('/calendar/events', async (req, res) => {
    const q = parse(
      z.object({ start: isoDate, end: isoDate, tz: z.string().refine(isValidTimeZone, 'Unknown time zone'), refresh: z.string().optional() }),
      req.query,
      res,
    );
    if (!q) return;
    if (q.end <= q.start || q.end > addDays(q.start, 62)) {
      return void res.status(400).json({ error: 'Range must be between 1 and 62 days' });
    }
    const { events, errors } = await loadEvents(store.data.calendar.sources, rangeQuery(q.start, q.end, q.tz), q.refresh === '1');
    const body: CalendarResponse = {
      events: sortEvents(events),
      errors,
      connected: { links: store.data.calendar.sources.length, icloud: config.caldav.enabled },
    };
    res.json(body);
  });

  api.get('/calendar/sources', (_req, res) => {
    res.json({ sources: store.data.calendar.sources, icloud: config.caldav.enabled, icloudUser: config.caldav.username });
  });

  api.post('/calendar/sources', async (req, res) => {
    const s = parse(sourceInput, req.body, res);
    if (!s) return;
    // Check the link works before saving it, so mistakes show up right away.
    try {
      const r = await fetch(normalizeCalendarUrl(s.url), { signal: AbortSignal.timeout(15_000) });
      const text = r.ok ? await r.text() : '';
      if (!r.ok) throw new Error(`the server answered HTTP ${r.status}`);
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error("that link doesn't return a calendar file");
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return void res.status(400).json({ error: `Couldn't load that calendar: ${why}` });
    }
    const source = { id: newId(), ...s };
    store.update((d) => d.calendar.sources.push(source));
    res.json(source);
  });

  api.delete('/calendar/sources/:id', (req, res) => {
    const id = param(req, 'id');
    store.update((d) => {
      d.calendar.sources = d.calendar.sources.filter((s) => s.id !== id);
    });
    res.json({ ok: true });
  });

  // ---------- Coach ----------
  let client = anthropic;
  let coachBusy = false;
  const coachReady = () => Boolean(client) || config.coach.configured;

  api.get('/coach', (_req, res) => {
    const body: CoachState = {
      configured: coachReady(),
      messages: toChatItems(store.data.coach.messages, store.data.health.profile.units),
    };
    res.json(body);
  });

  api.post('/coach/reset', (_req, res) => {
    if (coachBusy) return void res.status(409).json({ error: 'The coach is still replying' });
    store.update((d) => {
      d.coach.messages = [];
    });
    res.json({ ok: true });
  });

  api.post('/coach/chat', async (req, res) => {
    const body = parse(
      z.object({
        message: z.string().trim().min(1).max(8000),
        today: isoDate,
        tz: z.string().refine(isValidTimeZone, 'Unknown time zone'),
      }),
      req.body,
      res,
    );
    if (!body) return;
    if (!coachReady()) {
      return void res.status(503).json({ error: 'Add ANTHROPIC_API_KEY to your .env file to turn on the coach.' });
    }
    if (coachBusy) return void res.status(409).json({ error: 'The coach is still replying' });
    client ??= new Anthropic();
    coachBusy = true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      await runCoachTurn({
        store,
        client,
        message: body.message,
        today: body.today,
        tz: body.tz,
        emit: (e: CoachEvent) => send(e.type, e),
        loadTodayEvents: async () => {
          const r = await Promise.race([
            loadEvents(store.data.calendar.sources, rangeQuery(body.today, addDays(body.today, 1), body.tz)),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('calendar timed out')), 8000)),
          ]);
          return { events: sortEvents(r.events), error: r.errors.length ? r.errors.join('; ') : undefined };
        },
      });
      send('done', {});
    } catch (err) {
      send('error', { message: coachErrorMessage(err) });
    } finally {
      coachBusy = false;
      res.end();
    }
  });

  // ---------- Export ----------
  api.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="hq-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(store.data);
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  return app;
}

function coachErrorMessage(err: unknown): string {
  if (err instanceof CoachDeclinedError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in your .env file.';
  if (err instanceof Anthropic.RateLimitError) return 'The coach is rate-limited right now. Try again in a minute.';
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? 'unknown'}): ${err.message}`;
  console.error('coach error', err);
  return err instanceof Error ? err.message : 'Something went wrong.';
}
