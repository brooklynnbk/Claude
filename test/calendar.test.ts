import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandIcs, sortEvents } from '../server/calendar/ics.ts';
import { normalizeCalendarUrl } from '../server/calendar/sources.ts';
import { zonedRange, zonedToUtc } from '../server/lib/time.ts';

const ics = fs.readFileSync(new URL('./fixtures/apple.ics', import.meta.url), 'utf8');

function week(tz: string, text = ics) {
  const { start, end } = zonedRange('2026-11-02', '2026-11-09', tz);
  return sortEvents(
    expandIcs(text, {
      startDate: '2026-11-02',
      endDate: '2026-11-09',
      rangeStart: start,
      rangeEnd: end,
      userTz: tz,
      calendar: 'Personal',
      color: '#ff0000',
      sourceId: 'test',
    }),
  );
}

describe('zonedToUtc', () => {
  it('handles both sides of a DST change', () => {
    // Oct 30 2026 is EDT (UTC-4), Nov 2 2026 is EST (UTC-5)
    expect(new Date(zonedToUtc(2026, 10, 30, 9, 0, 0, 'America/New_York')).toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(new Date(zonedToUtc(2026, 11, 2, 9, 0, 0, 'America/New_York')).toISOString()).toBe('2026-11-02T14:00:00.000Z');
    expect(new Date(zonedToUtc(2026, 7, 1, 0, 0, 0, 'Asia/Tokyo')).toISOString()).toBe('2026-06-30T15:00:00.000Z');
  });
});

describe('expandIcs', () => {
  it('expands an Apple calendar week correctly', () => {
    const events = week('America/New_York');
    const summary = events.map((e) => [e.title, e.start, e.end, e.allDay]);
    expect(summary).toEqual([
      ['Trip', '2026-10-30', '2026-11-03', true],
      // 9:00 EST after the DST change (the series started in EDT)
      ['Standup', '2026-11-02T14:00:00.000Z', '2026-11-02T14:30:00.000Z', false],
      ['Market day', '2026-11-03', '2026-11-04', true],
      // Wed Nov 4 is an EXDATE, so no standup that day
      ['Call with printer', '2026-11-05T17:00:00.000Z', '2026-11-05T18:00:00.000Z', false],
      // Friday's standup was moved to 11:00; Friday's gym was cancelled
      ['Standup (moved)', '2026-11-06T16:00:00.000Z', '2026-11-06T16:30:00.000Z', false],
      // Floating time is read in the user's zone
      ['Farmers market', '2026-11-07T13:00:00.000Z', '2026-11-07T14:00:00.000Z', false],
    ]);
    expect(events.find((e) => e.title === 'Call with printer')?.location).toBe('Zoom');
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it('uses the platform tz database when the file has no VTIMEZONE', () => {
    const noTz = ics.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/, '');
    const events = week('America/New_York', noTz);
    expect(events.find((e) => e.title === 'Standup')?.start).toBe('2026-11-02T14:00:00.000Z');
  });

  it('keeps zoned events fixed when the viewer is in another zone', () => {
    const events = week('America/Los_Angeles');
    expect(events.find((e) => e.title === 'Standup')?.start).toBe('2026-11-02T14:00:00.000Z');
    // floating event follows the viewer: 8:00 Pacific
    expect(events.find((e) => e.title === 'Farmers market')?.start).toBe('2026-11-07T16:00:00.000Z');
  });
});

describe('normalizeCalendarUrl', () => {
  it('turns webcal links into https', () => {
    expect(normalizeCalendarUrl(' webcal://p01-caldav.icloud.com/published/2/abc ')).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    );
  });
});
