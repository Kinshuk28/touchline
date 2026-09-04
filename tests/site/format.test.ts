import { describe, it, expect } from 'vitest';
import { formatKickoff, formatKickoffTime, relativeTime, dataAge, checkedAge } from '@/lib/site/format';

const now = new Date('2026-08-16T12:00:00Z');

// Every kickoff literal here is 5:30 earlier in UTC than the IST time the
// expected string names (e.g. 13:30 UTC = 19:00 IST) — times are displayed
// in IST (lib/site/timezone.ts), so a naive UTC literal at ":19:00:00Z"
// would actually roll over past midnight into the next IST calendar day.
// See the "crosses midnight in IST" describe block below, which tests that
// rollover deliberately instead of accidentally.
describe('formatKickoff', () => {
  it('shows only a time for a fixture later today', () => {
    expect(formatKickoff('2026-08-16T13:30:00Z', now)).toBe('19:00');
  });
  it('shows a weekday and time within the coming week', () => {
    expect(formatKickoff('2026-08-18T13:30:00Z', now)).toBe('Tue 19:00');
  });
  it('shows a date for anything further out', () => {
    expect(formatKickoff('2026-10-01T13:30:00Z', now)).toBe('1 Oct');
  });
});

// Important 3: formatKickoff's >7-days-out branch drops the time entirely,
// which is invisible while every fixture in the database sits within a week
// of "now" but breaks the moment they don't — as is the case for the whole
// preseason. formatKickoffTime is the same day-window rule with the time
// never dropped.
describe('formatKickoffTime', () => {
  it('shows only a time for a fixture later today (same as formatKickoff)', () => {
    expect(formatKickoffTime('2026-08-16T13:30:00Z', now)).toBe('19:00');
  });
  it('shows a weekday and time within the coming week (same as formatKickoff)', () => {
    expect(formatKickoffTime('2026-08-18T13:30:00Z', now)).toBe('Tue 19:00');
  });
  it('keeps the time for anything further out, unlike formatKickoff', () => {
    expect(formatKickoffTime('2026-10-01T13:30:00Z', now)).toBe('1 Oct 19:00');
  });
  it('this is the real preseason case: every fixture starts out more than 7 days from now', () => {
    // Season starts 2026-08-16; "now" here stands in for today (2026-08-04).
    const preseason = new Date('2026-08-04T00:00:00Z');
    expect(formatKickoffTime('2026-08-16T13:30:00Z', preseason)).toBe('16 Aug 19:00');
  });

  // /calendar already states the date via its day-grouping heading — asking
  // for `dateContext: true` there keeps the far-out branch at weekday+time
  // instead of repeating the date the heading already gave, and caps the
  // column's width requirement at "Tue 19:00" rather than "16 Aug 19:00".
  describe('with dateContext: true', () => {
    it('still shows only a time for later today', () => {
      expect(formatKickoffTime('2026-08-16T13:30:00Z', now, { dateContext: true })).toBe('19:00');
    });
    it('shows weekday and time within the coming week, same as without the option', () => {
      expect(formatKickoffTime('2026-08-18T13:30:00Z', now, { dateContext: true })).toBe('Tue 19:00');
    });
    it('stays at weekday+time even far out, unlike the default (no repeated date)', () => {
      expect(formatKickoffTime('2026-10-01T13:30:00Z', now, { dateContext: true })).toBe('Thu 19:00');
    });
  });

  // A UTC kickoff late in the evening lands after midnight IST — the whole
  // reason `groupFixturesByDay` (lib/site/spine.ts) buckets by the IST
  // calendar date rather than the raw UTC one, and worth a dedicated case
  // here rather than leaving it as an accidental side effect of some other
  // literal.
  describe('a kickoff that crosses midnight in IST', () => {
    it('rolls over to the next IST day and shows that weekday, not the UTC one', () => {
      // 2026-08-16T19:00:00Z is 2026-08-17T00:30 IST — the next calendar day.
      expect(formatKickoffTime('2026-08-16T19:00:00Z', now)).toBe('Mon 00:30');
    });
  });
});

describe('relativeTime', () => {
  it('returns null for a null timestamp rather than inventing one', () => {
    expect(relativeTime(null, now)).toBeNull();
  });
  it('reports minutes for something recent', () => {
    expect(relativeTime('2026-08-16T11:38:00Z', now)).toBe('22 min ago');
  });
  it('reports hours past an hour', () => {
    expect(relativeTime('2026-08-16T09:00:00Z', now)).toBe('3 hours ago');
  });
  it('uses a singular hour at exactly one', () => {
    expect(relativeTime('2026-08-16T11:00:00Z', now)).toBe('1 hour ago');
  });
  it('reports days past a day', () => {
    expect(relativeTime('2026-08-14T12:00:00Z', now)).toBe('2 days ago');
  });
  it('returns null for a future timestamp five minutes ahead', () => {
    expect(relativeTime('2026-08-16T12:05:00Z', now)).toBeNull();
  });
  it('returns null for a future timestamp two days ahead', () => {
    expect(relativeTime('2026-08-18T12:00:00Z', now)).toBeNull();
  });
  it('returns just now for exactly now', () => {
    expect(relativeTime('2026-08-16T12:00:00Z', now)).toBe('just now');
  });
});

describe('dataAge', () => {
  it('says just now for something within the minute', () => {
    expect(dataAge('2026-08-16T11:59:40Z', now)).toBe('just now');
  });
  it('otherwise reads as an update stamp', () => {
    expect(dataAge('2026-08-16T11:30:00Z', now)).toBe('updated 30 min ago');
  });
  it('returns update time unknown for a future timestamp', () => {
    expect(dataAge('2026-08-16T12:05:00Z', now)).toBe('update time unknown');
  });
});

// Important 6: the freshness stamp must track poll success, not data
// change — "checked X ago" answers "is the panel still polling", which
// "updated X ago" (derived from a row's own updated_at) cannot: that stamp
// freezes for as long as the score genuinely doesn't change.
describe('checkedAge', () => {
  it('says just now for a poll within the minute', () => {
    expect(checkedAge('2026-08-16T11:59:40Z', now)).toBe('checked just now');
  });
  it('otherwise reads as a checked stamp', () => {
    expect(checkedAge('2026-08-16T11:58:00Z', now)).toBe('checked 2 min ago');
  });
  it('returns check time unknown for a future timestamp', () => {
    expect(checkedAge('2026-08-16T12:05:00Z', now)).toBe('check time unknown');
  });
});
