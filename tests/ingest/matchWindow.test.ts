import { describe, it, expect } from 'vitest';
import { isMatchWindowOpen, isLiveRelevant } from '@/lib/ingest/matchWindow';

const at = (iso: string) => new Date(iso);

describe('isMatchWindowOpen', () => {
  it('is closed when there are no fixtures at all', () => {
    expect(isMatchWindowOpen([], at('2026-08-03T12:00:00Z'))).toBe(false);
  });

  it('is closed during preseason, days before the first kickoff', () => {
    const f = [{ status: 'SCHEDULED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-03T12:00:00Z'))).toBe(false);
  });

  it('opens 15 minutes before kickoff', () => {
    const f = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T13:44:00Z'))).toBe(false);
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('is open whenever any fixture reports IN_PLAY, regardless of clock', () => {
    const f = [{ status: 'IN_PLAY' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T20:00:00Z'))).toBe(true);
  });

  it('stays open at half-time (PAUSED)', () => {
    const f = [{ status: 'PAUSED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:50:00Z'))).toBe(true);
  });

  it('closes 150 minutes after the last kickoff', () => {
    const f = [{ status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T16:29:00Z'))).toBe(true);
    expect(isMatchWindowOpen(f, at('2026-08-21T16:31:00Z'))).toBe(false);
  });

  it('spans a full matchday from the earliest to the latest kickoff', () => {
    const f = [
      { status: 'FINISHED' as const, kickoffUtc: '2026-08-22T11:30:00Z' },
      { status: 'TIMED' as const, kickoffUtc: '2026-08-22T19:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-22T15:00:00Z'))).toBe(true);
    expect(isMatchWindowOpen(f, at('2026-08-22T22:00:00Z'))).toBe(false);
  });

  it('ignores postponed and cancelled fixtures (but not suspended) when deciding to open', () => {
    const f = [
      { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('a lone SUSPENDED fixture in-window opens the window (suspended matches can resume)', () => {
    const f = [{ status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('a lone SUSPENDED fixture far outside the window closes it (treated as scheduled)', () => {
    const f = [{ status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-19T12:00:00Z'))).toBe(false);
  });

  it('postponed and cancelled together in-window still closes', () => {
    const f = [
      { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T15:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('poisoning case: a genuinely in-window TIMED fixture plus an unparseable date still opens the window', () => {
    const f = [
      { status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
    ];
    // At 13:46 (14 minutes before kickoff), window should be open regardless of the bad date
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('in-play short-circuit survives an unparseable date on the same fixture', () => {
    const f = [{ status: 'IN_PLAY' as const, kickoffUtc: 'not-a-date' }];
    // IN_PLAY should keep the window open even with an unparseable date
    expect(isMatchWindowOpen(f, at('2026-08-21T20:00:00Z'))).toBe(true);
  });

  it('all rows unparseable returns false', () => {
    const f = [
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
      { status: 'TIMED' as const, kickoffUtc: 'also-not-a-date' },
    ];
    // No valid kickoff times, window closed
    expect(isMatchWindowOpen(f, at('2026-08-21T14:00:00Z'))).toBe(false);
  });

  it('a bad date does not widen the window: in-window fixture alone vs with bad date', () => {
    const goodFixture = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    const withBadDate = [
      { status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
    ];

    // Inside the window: both should be true
    expect(isMatchWindowOpen(goodFixture, at('2026-08-21T13:46:00Z'))).toBe(true);
    expect(isMatchWindowOpen(withBadDate, at('2026-08-21T13:46:00Z'))).toBe(true);

    // Outside the window: both should be false
    expect(isMatchWindowOpen(goodFixture, at('2026-08-21T10:00:00Z'))).toBe(false);
    expect(isMatchWindowOpen(withBadDate, at('2026-08-21T10:00:00Z'))).toBe(false);
  });

  it('boundary: opens exactly 15 minutes before kickoff (pins >=)', () => {
    const f = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    // Exactly 15 minutes before: 14:00:00 - 15min = 13:45:00
    expect(isMatchWindowOpen(f, at('2026-08-21T13:45:00Z'))).toBe(true);
  });

  it('boundary: closes exactly 150 minutes after the last kickoff (pins <=)', () => {
    const f = [{ status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    // Exactly 150 minutes after: 14:00:00 + 150min = 16:30:00
    expect(isMatchWindowOpen(f, at('2026-08-21T16:30:00Z'))).toBe(true);
  });
});

describe('isLiveRelevant', () => {
  it('IN_PLAY is always relevant, regardless of kickoff time', () => {
    const f = { status: 'IN_PLAY' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // Two hours after kickoff
    expect(isLiveRelevant(f, at('2026-08-21T16:00:00Z'))).toBe(true);
    // Three weeks after kickoff
    expect(isLiveRelevant(f, at('2026-09-11T14:00:00Z'))).toBe(true);
  });

  it('PAUSED is always relevant, regardless of kickoff time', () => {
    const f = { status: 'PAUSED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // Two hours after kickoff
    expect(isLiveRelevant(f, at('2026-08-21T16:00:00Z'))).toBe(true);
  });

  it('FINISHED is relevant 30 minutes after kickoff (recently finished, score may still settle)', () => {
    const f = { status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // 30 minutes after: 14:00:00 + 30min = 14:30:00
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(true);
  });

  it('FINISHED is NOT relevant three weeks after kickoff (ancient match, this is the bug)', () => {
    const f = { status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // 21 days + 0 minutes = 30,240 minutes after kickoff
    expect(isLiveRelevant(f, at('2026-09-11T14:00:00Z'))).toBe(false);
  });

  it('SCHEDULED is never relevant', () => {
    const f = { status: 'SCHEDULED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('TIMED is never relevant', () => {
    const f = { status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('POSTPONED is never relevant', () => {
    const f = { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('SUSPENDED is always relevant, regardless of kickoff time — the live job must be the fast writer for a suspension', () => {
    const f = { status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(true);
  });

  it('SUSPENDED boundary: still relevant three weeks after kickoff, unlike FINISHED — matches isMatchWindowOpen treating it as never dead', () => {
    const f = { status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-09-11T14:00:00Z'))).toBe(true);
  });

  it('AWARDED is always relevant, regardless of kickoff time — the live job must be the fast writer for a forfeit decision', () => {
    const f = { status: 'AWARDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(true);
  });

  it('AWARDED boundary: still relevant three weeks after kickoff, same as SUSPENDED', () => {
    const f = { status: 'AWARDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-09-11T14:00:00Z'))).toBe(true);
  });

  it('CANCELLED is never relevant', () => {
    const f = { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('FINISHED: boundary at exactly 150 minutes after kickoff (relevant)', () => {
    const f = { status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // Exactly 150 minutes after: 14:00:00 + 150min = 16:30:00
    expect(isLiveRelevant(f, at('2026-08-21T16:30:00Z'))).toBe(true);
  });

  it('FINISHED: boundary at 150 minutes + 1 second after kickoff (not relevant)', () => {
    const f = { status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' };
    // 150 minutes + 1 second: 16:30:01
    expect(isLiveRelevant(f, at('2026-08-21T16:30:01Z'))).toBe(false);
  });

  it('FINISHED with unparseable kickoff time is not relevant', () => {
    const f = { status: 'FINISHED' as const, kickoffUtc: 'not-a-date' };
    expect(isLiveRelevant(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });
});
