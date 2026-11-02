import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { beforeEach, describe, expect, it } from 'vitest';
import { repairTranscript, runCoachTurn, sanitizeAfterFallback, toChatItems, type CoachEvent } from '../server/coach/coach.ts';
import { SYSTEM_PROMPT } from '../server/coach/prompt.ts';
import { Store } from '../server/db.ts';
import { MemoryBackend } from '../server/storage.ts';

type Scripted = Partial<BetaMessage> & { content: BetaContentBlock[] };

/** Minimal stand-in for client.beta.messages.stream that replays scripted replies. */
function fakeClient(script: (Scripted | Error)[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: any) {
          // Snapshot the request the way the SDK would serialize it.
          calls.push(JSON.parse(JSON.stringify(params)));
          const next = script.shift();
          const handlers: ((t: string) => void)[] = [];
          return {
            on(event: string, cb: (t: string) => void) {
              if (event === 'text') handlers.push(cb);
              return this;
            },
            async finalMessage() {
              if (!next) throw new Error('script exhausted');
              if (next instanceof Error) throw next;
              for (const b of next.content) if (b.type === 'text') handlers.forEach((h) => h(b.text));
              return { stop_reason: 'end_turn', ...next } as BetaMessage;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, 'beta'>, calls };
}

const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' } as BetaContentBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as BetaContentBlock;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as BetaContentBlock;

let store: Store;
beforeEach(async () => {
  store = new Store(new MemoryBackend());
  await store.update((d) => {
    d.health.profile = { units: 'lb', goalWeight: 150, startWeight: 180, targetDate: '2027-06-01' };
    d.health.weights = [
      { date: '2026-10-30', weight: 176 },
      { date: '2026-11-01', weight: 175.2 },
    ];
  });
});

const baseTurn = (client: Pick<Anthropic, 'beta'>, events: CoachEvent[], message: string) => ({
  store,
  client,
  message,
  today: '2026-11-02',
  tz: 'America/New_York',
  now: new Date('2026-11-02T13:30:00Z'),
  loadTodayEvents: async () => ({
    events: [
      {
        id: 'x',
        title: 'Client call',
        start: '2026-11-02T15:00:00.000Z',
        end: '2026-11-02T16:00:00.000Z',
        allDay: false,
        calendar: 'Work',
        color: '#000000',
      },
    ],
  }),
  emit: (e: CoachEvent) => events.push(e),
});

describe('runCoachTurn', () => {
  it('runs tools, stores an append-only transcript, and streams text', async () => {
    const { client, calls } = fakeClient([
      { content: [thinking, toolUse('t1', 'log_weight', { weight: 174.6 }), toolUse('t2', 'add_habit', { name: 'Walk 20 min', emoji: '🚶' })], stop_reason: 'tool_use' },
      { content: [text('Nice — logged 174.6. Your walk habit is in the tracker.')] },
    ]);
    const events: CoachEvent[] = [];
    await runCoachTurn(baseTurn(client, events, 'Weighed 174.6 this morning. Add a walking habit?'));

    // Data was written
    expect(store.data.health.weights.at(-1)).toEqual({ date: '2026-11-02', weight: 174.6 });
    expect(store.data.habits.habits.map((h) => h.name)).toEqual(['Walk 20 min']);

    // Transcript: user, context, assistant(tool calls, thinking kept as-is), tool results, assistant
    const msgs = store.data.coach.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant']);
    expect((msgs[2].content as any[])[0]).toEqual(thinking);
    expect((msgs[3].content as any[]).map((b) => b.tool_use_id)).toEqual(['t1', 't2']);

    // The context note carries today's calendar and weight trend
    const context = msgs[1].content as string;
    expect(context).toContain('Client call');
    expect(context).toContain('10:00 AM');
    expect(context).toContain('Goal weight: 150 lb');

    // Each request's prefix is the previous request plus appended messages (no edits)
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.slice(0, calls[0].messages.length)).toEqual(calls[0].messages);
    for (const c of calls) {
      expect(c.system).toBe(SYSTEM_PROMPT);
      expect(c.model).toBe('claude-opus-5-5');
      expect(c.fallbacks).toBe('default');
      expect(c.betas).toEqual(['server-side-fallback-2026-07-01']);
      expect(c.tools.every((t: any) => t.eager_input_streaming === true)).toBe(true);
    }

    expect(events.filter((e) => e.type === 'action').map((e) => (e as any).text)).toEqual([
      'Logged weigh-in: 174.6 lb',
      'Added habit: 🚶 Walk 20 min',
    ]);
    expect(events.some((e) => e.type === 'text')).toBe(true);

    expect(toChatItems(msgs, 'lb')).toEqual([
      { role: 'user', text: 'Weighed 174.6 this morning. Add a walking habit?', actions: [] },
      {
        role: 'assistant',
        text: 'Nice — logged 174.6. Your walk habit is in the tracker.',
        actions: ['Logged weigh-in: 174.6 lb', 'Added habit: 🚶 Walk 20 min'],
      },
    ]);
  });

  it('returns invalid tool input to Claude as an error instead of running it', async () => {
    const { client, calls } = fakeClient([
      { content: [toolUse('t1', 'log_weight', { weight: 'heavy' })], stop_reason: 'tool_use' },
      { content: [text('What number did the scale show?')] },
    ]);
    await runCoachTurn(baseTurn(client, [], 'log my weight'));
    const result = calls[1].messages.at(-1).content[0];
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content).INVALID_JSON).toBe('{"weight":"heavy"}');
    expect(store.data.health.weights).toHaveLength(2);
  });

  it('rolls back the turn if the API fails before answering', async () => {
    const { client } = fakeClient([new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers())]);
    await expect(runCoachTurn(baseTurn(client, [], 'hi'))).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(store.data.coach.messages).toEqual([]);
  });

  it('rolls back and reports a refusal with no answer', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'refusal' }]);
    await expect(runCoachTurn(baseTurn(client, [], 'hi'))).rejects.toThrow(/can't help/);
    expect(store.data.coach.messages).toEqual([]);
  });

  it('continues an existing conversation with the same system prompt', async () => {
    const first = fakeClient([{ content: [text('Hi!')] }]);
    await runCoachTurn(baseTurn(first.client, [], 'hello'));
    const second = fakeClient([{ content: [text('Sure.')] }]);
    await runCoachTurn(baseTurn(second.client, [], 'plan my week'));
    const sent = second.calls[0].messages;
    expect(sent.map((m: any) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'system']);
    expect(sent.slice(0, 3)).toEqual(first.calls[0].messages.concat([{ role: 'assistant', content: [text('Hi!')] }]));
  });
});

describe('repairTranscript', () => {
  it('drops a trailing message that never got a reply', () => {
    const msgs: any[] = [
      { role: 'user', content: 'a' },
      { role: 'system', content: 'ctx' },
      { role: 'assistant', content: [text('hi')] },
      { role: 'user', content: 'b' },
      { role: 'system', content: 'ctx2' },
    ];
    repairTranscript(msgs);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'system', 'assistant']);
  });

  it('answers tool calls that were interrupted before running', () => {
    const msgs: any[] = [
      { role: 'user', content: 'a' },
      { role: 'system', content: 'ctx' },
      { role: 'assistant', content: [toolUse('t9', 'log_weight', { weight: 1 })] },
    ];
    repairTranscript(msgs);
    expect(msgs.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', is_error: true }] });
  });

  it('leaves a healthy transcript alone', () => {
    const msgs: any[] = [
      { role: 'user', content: 'a' },
      { role: 'system', content: 'ctx' },
      { role: 'assistant', content: [text('hi')] },
    ];
    repairTranscript(msgs);
    expect(msgs).toHaveLength(3);
  });

  it('is applied before the next turn', async () => {
    await store.update((d) => {
      d.coach.messages.push({ role: 'user', content: 'cut off' }, { role: 'system', content: 'ctx' });
    });
    const { client, calls } = fakeClient([{ content: [text('Hello again')] }]);
    await runCoachTurn(baseTurn(client, [], 'hi'));
    expect(calls[0].messages.map((m: any) => m.role)).toEqual(['user', 'system']);
    expect(calls[0].messages[0].content).toBe('hi');
  });
});

describe('sanitizeAfterFallback', () => {
  it('drops non-text blocks the declining model produced before the fallback marker', () => {
    const fb = { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } } as unknown as BetaContentBlock;
    const out = sanitizeAfterFallback([thinking, text('partial'), toolUse('x', 'remember', {}), fb, thinking, text('rest')]);
    expect(out.map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'text']);
  });
});
