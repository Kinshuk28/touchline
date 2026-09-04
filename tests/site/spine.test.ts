import { describe, it, expect } from 'vitest';
import { dayRailParts, groupFixturesByDay, spineCenterText, spineRowKind, spineStateLabel } from '@/lib/site/spine';
import type { FixtureStatus } from '@/lib/providers/types';
import type { FixtureWithTeams } from '@/lib/site/rows';

function fixture(overrides: { status: FixtureStatus; home_goals?: number | null; away_goals?: number | null }) {
  return { status: overrides.status, home_goals: overrides.home_goals ?? null, away_goals: overrides.away_goals ?? null };
}

describe('spineRowKind', () => {
  it('is upcoming for a scheduled fixture with no score', () => {
    expect(spineRowKind(fixture({ status: 'SCHEDULED' }))).toBe('upcoming');
    expect(spineRowKind(fixture({ status: 'TIMED' }))).toBe('upcoming');
  });

  it('is live for IN_PLAY/PAUSED, regardless of whether a score is already set', () => {
    expect(spineRowKind(fixture({ status: 'IN_PLAY', home_goals: 1, away_goals: 0 }))).toBe('live');
    expect(spineRowKind(fixture({ status: 'PAUSED', home_goals: 0, away_goals: 0 }))).toBe('live');
  });

  it('is played for a fixture with a genuine score pair, including a real 0-0', () => {
    expect(spineRowKind(fixture({ status: 'FINISHED', home_goals: 2, away_goals: 1 }))).toBe('played');
    expect(spineRowKind(fixture({ status: 'FINISHED', home_goals: 0, away_goals: 0 }))).toBe('played');
    expect(spineRowKind(fixture({ status: 'AWARDED', home_goals: 3, away_goals: 0 }))).toBe('played');
  });

  it('is postponed for POSTPONED/CANCELLED/SUSPENDED, even if a score happens to be set', () => {
    expect(spineRowKind(fixture({ status: 'POSTPONED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'CANCELLED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'SUSPENDED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'SUSPENDED', home_goals: 1, away_goals: 1 }))).toBe('postponed');
  });

  it('never claims "played" from status alone — a null score always falls through', () => {
    expect(spineRowKind(fixture({ status: 'FINISHED' }))).toBe('upcoming');
  });
});

describe('spineCenterText', () => {
  it('shows the score for played and live kinds', () => {
    expect(spineCenterText({ home_goals: 2, away_goals: 1 }, 'played')).toBe('2–1');
    expect(spineCenterText({ home_goals: 0, away_goals: 0 }, 'live')).toBe('0–0');
  });

  it('shows an em dash for upcoming and postponed kinds', () => {
    expect(spineCenterText({ home_goals: null, away_goals: null }, 'upcoming')).toBe('—');
    expect(spineCenterText({ home_goals: null, away_goals: null }, 'postponed')).toBe('—');
  });
});

describe('spineStateLabel', () => {
  it('is Live for IN_PLAY, with live: true', () => {
    expect(spineStateLabel({ status: 'IN_PLAY' })).toEqual({ text: 'Live', live: true });
  });

  it('is HT for PAUSED, with live: false — nothing is happening at half-time', () => {
    expect(spineStateLabel({ status: 'PAUSED' })).toEqual({ text: 'HT', live: false });
  });

  it('is FT for FINISHED and AWARDED', () => {
    expect(spineStateLabel({ status: 'FINISHED' })).toEqual({ text: 'FT', live: false });
    expect(spineStateLabel({ status: 'AWARDED' })).toEqual({ text: 'FT', live: false });
  });

  it('is Postp. for POSTPONED specifically, distinct from Cancelled/Suspended', () => {
    expect(spineStateLabel({ status: 'POSTPONED' })).toEqual({ text: 'Postp.', live: false });
    expect(spineStateLabel({ status: 'CANCELLED' })).toEqual({ text: 'Off', live: false });
    expect(spineStateLabel({ status: 'SUSPENDED' })).toEqual({ text: 'Off', live: false });
  });

  it('is null for an upcoming fixture, so no state column is reserved for it', () => {
    expect(spineStateLabel({ status: 'SCHEDULED' })).toBeNull();
    expect(spineStateLabel({ status: 'TIMED' })).toBeNull();
  });
});

function stubFixture(id: number, kickoffUtc: string): FixtureWithTeams {
  return {
    id, league_id: 1, season: 2026, kickoff_utc: kickoffUtc, status: 'SCHEDULED',
    matchday: 1, home_goals: null, away_goals: null,
    half_time_home: null, half_time_away: null, updated_at: kickoffUtc,
    home: null, away: null,
  };
}

describe('groupFixturesByDay', () => {
  it('buckets by the IST calendar date, not the raw UTC one', () => {
    // 2026-08-16T19:00:00Z is 2026-08-17T00:30 IST — the next day.
    const groups = groupFixturesByDay([stubFixture(1, '2026-08-16T19:00:00Z')]);
    expect(groups).toEqual([{ date: '2026-08-17', fixtures: [expect.objectContaining({ id: 1 })] }]);
  });

  it('keeps two fixtures on the same UTC date but different IST dates apart', () => {
    // 10:00Z stays on the 16th in IST (15:30); 19:00Z rolls to the 17th (00:30).
    const groups = groupFixturesByDay([
      stubFixture(1, '2026-08-16T10:00:00Z'),
      stubFixture(2, '2026-08-16T19:00:00Z'),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-08-16', '2026-08-17']);
  });

  it('preserves insertion order across day groups', () => {
    const groups = groupFixturesByDay([
      stubFixture(1, '2026-08-16T10:00:00Z'),
      stubFixture(2, '2026-08-17T10:00:00Z'),
      stubFixture(3, '2026-08-16T11:00:00Z'),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-08-16', '2026-08-17']);
    expect(groups[0]!.fixtures.map((f) => f.id)).toEqual([1, 3]);
  });
});

describe('dayRailParts', () => {
  it('parses a YYYY-MM-DD group key into day/month/weekday', () => {
    // 2026-08-16 is a Sunday.
    expect(dayRailParts('2026-08-16')).toEqual({ day: 16, month: 'Aug', weekday: 'Sun' });
  });

  it('parses the year boundary correctly', () => {
    expect(dayRailParts('2026-01-01')).toEqual({ day: 1, month: 'Jan', weekday: 'Thu' });
  });
});
