// The health coach conversation loop.
//
// Conversation rules that keep Claude's prompt cache and preserved thinking valid:
//  - the top-level system prompt and tool list never change mid-conversation;
//  - the stored message history is append-only (assistant content is stored
//    exactly as returned, thinking blocks included);
//  - fresh app data goes in as a `role: "system"` message appended after each
//    user message instead of rewriting anything earlier.

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { CalendarEvent, ChatItem, ISODate } from '../../shared/types.ts';
import { config } from '../config.ts';
import type { Store } from '../db.ts';
import { buildSnapshot, SYSTEM_PROMPT } from './prompt.ts';
import { describeAction, runTool, TOOLS } from './tools.ts';

/** Start a fresh conversation past this many stored messages (notes and data carry over). */
export const MAX_HISTORY_MESSAGES = 160;
const MAX_STEPS = 8;

export type CoachEvent =
  | { type: 'step' }
  | { type: 'text'; delta: string }
  | { type: 'retry' }
  | { type: 'action'; text: string }
  | { type: 'info'; text: string };

export interface TurnOptions {
  store: Store;
  client: Pick<Anthropic, 'beta'>;
  message: string;
  today: ISODate;
  tz: string;
  now?: Date;
  loadTodayEvents: () => Promise<{ events: CalendarEvent[]; error?: string }>;
  emit: (e: CoachEvent) => void;
}

export class CoachDeclinedError extends Error {}

/**
 * After a mid-output fallback, blocks the declining model produced before the
 * last `fallback` marker must not be echoed back — except plain text.
 */
export function sanitizeAfterFallback(content: BetaContentBlock[]): BetaContentBlock[] {
  let boundary = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') boundary = i;
  });
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === 'text');
}

export async function runCoachTurn(o: TurnOptions): Promise<void> {
  const { store, emit } = o;

  if (store.data.coach.messages.length > MAX_HISTORY_MESSAGES) {
    store.update((d) => {
      d.coach.messages = [];
    });
    emit({ type: 'info', text: 'Started a fresh conversation. Your goals, logs and coach notes carry over.' });
  }

  const calendar = await o.loadTodayEvents().catch((err: unknown) => ({
    events: [] as CalendarEvent[],
    error: err instanceof Error ? err.message : 'calendar unavailable',
  }));
  const snapshot = buildSnapshot(store, o.today, o.tz, o.now ?? new Date(), calendar);

  const startLength = store.data.coach.messages.length;
  store.update((d) => {
    d.coach.messages.push({ role: 'user', content: o.message }, { role: 'system', content: snapshot });
  });

  let answered = false;
  let jsonRetries = 0;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      emit({ type: 'step' });
      const stream = o.client.beta.messages.stream({
        model: config.coach.model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: config.coach.effort },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: store.data.coach.messages,
      });
      stream.on('text', (delta) => emit({ type: 'text', delta }));

      let message: BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming the SDK rejects if a tool input isn't parseable JSON.
        // Retry only that case; API errors (auth, rate limit, …) go to the caller.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        emit({ type: 'retry' });
        step--;
        continue;
      }

      if (message.stop_reason === 'refusal') {
        if (!answered) throw new CoachDeclinedError("The coach can't help with that request. Try rephrasing it.");
        break;
      }

      const content = sanitizeAfterFallback(message.content);
      const toolUses = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        throw new Error('The reply was cut off before the coach finished. Please try again.');
      }
      if (!content.length) break;

      store.update((d) => {
        d.coach.messages.push({ role: 'assistant', content: content as BetaContentBlockParam[] });
      });
      answered = true;

      if (!toolUses.length) break;

      const results: BetaToolResultBlockParam[] = toolUses.map((t) => {
        const outcome = runTool(t.name, t.input, { store, today: o.today });
        if (outcome.ok) {
          emit({ type: 'action', text: outcome.action });
          return { type: 'tool_result', tool_use_id: t.id, content: outcome.result };
        }
        return { type: 'tool_result', tool_use_id: t.id, content: outcome.error, is_error: true };
      });
      store.update((d) => {
        d.coach.messages.push({ role: 'user', content: results });
      });
    }
  } finally {
    // Nothing came back: drop this turn's user + context messages so history stays clean.
    if (!answered) {
      store.update((d) => {
        d.coach.messages.length = startLength;
      });
    }
  }
}

/** Turn the raw API transcript into chat bubbles for the UI. */
export function toChatItems(messages: BetaMessageParam[], units: string): ChatItem[] {
  const items: ChatItem[] = [];
  let current: ChatItem | null = null;

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((b): b is Extract<BetaContentBlockParam, { type: 'text' }> => b.type === 'text')
              .map((b) => b.text)
              .join('\n');
      if (!text) continue; // tool results only
      current = null;
      items.push({ role: 'user', text, actions: [] });
      continue;
    }
    if (!current) {
      current = { role: 'assistant', text: '', actions: [] };
      items.push(current);
    }
    const blocks = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === 'text' && b.text.trim()) current.text += (current.text ? '\n\n' : '') + b.text.trim();
      if (b.type === 'tool_use') current.actions.push(describeAction(b.name, b.input, units));
    }
  }
  return items.filter((i) => i.text || i.actions.length);
}
