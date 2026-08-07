import { describe, it, expect } from 'vitest';
import { openGameweek, timeUntilDeadline, type GameweekWindow } from '@/lib/fantasy/gameweekWindow';

const NOW = new Date('2026-09-15T12:00:00Z');

function gw(gameweek: number, over: Partial<GameweekWindow> = {}): GameweekWindow {
  return { gameweek, deadlineUtc: '2026-09-20T10:00:00Z', finished: false, ...over };
}

describe('openGameweek', () => {
  it('is the first gameweek whose deadline has not passed', () => {
    const calendar = [
      gw(1, { deadlineUtc: '2026-08-14T10:00:00Z', finished: true }),
      gw(2, { deadlineUtc: '2026-09-12T10:00:00Z', finished: true }),
      gw(3, { deadlineUtc: '2026-09-19T10:00:00Z' }),
      gw(4, { deadlineUtc: '2026-09-26T10:00:00Z' }),
    ];
    expect(openGameweek(calendar, NOW)).toBe(3);
  });

  it('moves on the moment a deadline passes — you cannot change a side mid-match', () => {
    const justOpen = [gw(3, { deadlineUtc: '2026-09-15T12:00:01Z' }), gw(4)];
    expect(openGameweek(justOpen, NOW)).toBe(3);

    const justClosed = [gw(3, { deadlineUtc: '2026-09-15T11:59:59Z' }), gw(4)];
    expect(openGameweek(justClosed, NOW)).toBe(4);
  });

  it('skips a gameweek already finished even if its deadline somehow reads as future', () => {
    const calendar = [gw(3, { finished: true }), gw(4, { deadlineUtc: '2026-09-27T10:00:00Z' })];
    expect(openGameweek(calendar, NOW)).toBe(4);
  });

  it('skips a gameweek with no published deadline rather than assuming it is open', () => {
    // Guessing "open" is the direction that lets somebody edit a side
    // mid-match. Guessing "closed" only costs them a week.
    const calendar = [gw(3, { deadlineUtc: null }), gw(4, { deadlineUtc: '2026-09-26T10:00:00Z' })];
    expect(openGameweek(calendar, NOW)).toBe(4);
  });

  it('returns null when the season is over', () => {
    expect(openGameweek([gw(38, { deadlineUtc: '2026-05-01T10:00:00Z', finished: true })], NOW)).toBeNull();
    expect(openGameweek([], NOW)).toBeNull();
  });

  it('does not depend on the calendar arriving in order', () => {
    const shuffled = [gw(4, { deadlineUtc: '2026-09-26T10:00:00Z' }), gw(3, { deadlineUtc: '2026-09-19T10:00:00Z' })];
    expect(openGameweek(shuffled, NOW)).toBe(3);
  });
});

describe('timeUntilDeadline', () => {
  it('reports minutes, hours and days at the scales that matter', () => {
    expect(timeUntilDeadline('2026-09-15T12:30:00Z', NOW)).toBe('30 minutes');
    expect(timeUntilDeadline('2026-09-15T13:00:00Z', NOW)).toBe('1 hour');
    expect(timeUntilDeadline('2026-09-16T18:00:00Z', NOW)).toBe('30 hours');
    expect(timeUntilDeadline('2026-09-20T12:00:00Z', NOW)).toBe('5 days');
  });

  it('says the deadline is closed rather than counting backwards', () => {
    expect(timeUntilDeadline('2026-09-15T11:59:00Z', NOW)).toBe('closed');
    expect(timeUntilDeadline('2026-09-15T12:00:00Z', NOW)).toBe('closed');
  });

  it('never counts individual seconds at a manager', () => {
    expect(timeUntilDeadline('2026-09-15T12:00:30Z', NOW)).toBe('under a minute');
  });

  it('returns null for a missing or unreadable deadline', () => {
    expect(timeUntilDeadline(null, NOW)).toBeNull();
    expect(timeUntilDeadline('some saturday', NOW)).toBeNull();
  });

  it('uses the singular where English needs it', () => {
    expect(timeUntilDeadline('2026-09-15T12:01:30Z', NOW)).toBe('1 minute');
  });
});
