import { describe, it, expect } from 'vitest';
import { isMarqueeClubId, selectMarqueeFixtures, MARQUEE_CLUB_FD_IDS } from '@/lib/site/marqueeClubs';
import type { FixtureWithTeams, TeamLite } from '@/lib/site/rows';

function team(fdId: number, name: string): TeamLite {
  return { id: fdId, fd_id: fdId, slug: name.toLowerCase(), name, short_name: name, tla: name.slice(0, 3).toUpperCase(), crest_url: null };
}

function fixture(overrides: Partial<FixtureWithTeams> & { id: number; kickoff_utc: string }): FixtureWithTeams {
  return {
    league_id: 15, season: 2026, status: 'SCHEDULED', matchday: null,
    home_goals: null, away_goals: null, updated_at: overrides.kickoff_utc,
    home: null, away: null,
    ...overrides,
  };
}

const REAL_MADRID = 86; // must be a real curated id — this test would be meaningless against a made-up one
const NON_MARQUEE = 999999;

describe('MARQUEE_CLUB_FD_IDS', () => {
  it('has no duplicate ids', () => {
    expect(new Set(MARQUEE_CLUB_FD_IDS).size).toBe(MARQUEE_CLUB_FD_IDS.length);
  });

  it('is a non-trivial curated list', () => {
    expect(MARQUEE_CLUB_FD_IDS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('isMarqueeClubId', () => {
  it('recognises a curated id', () => {
    expect(isMarqueeClubId(REAL_MADRID)).toBe(true);
  });

  it('rejects an id not on the list', () => {
    expect(isMarqueeClubId(NON_MARQUEE)).toBe(false);
  });

  it('rejects null/undefined without throwing', () => {
    expect(isMarqueeClubId(null)).toBe(false);
    expect(isMarqueeClubId(undefined)).toBe(false);
  });
});

describe('selectMarqueeFixtures', () => {
  it('picks fixtures involving a marquee club, chronologically, up to count', () => {
    const fixtures = [
      fixture({ id: 1, kickoff_utc: '2026-08-15T10:00:00Z', home: team(REAL_MADRID, 'Real Madrid'), away: team(NON_MARQUEE, 'Filler') }),
      fixture({ id: 2, kickoff_utc: '2026-08-15T11:00:00Z', home: team(NON_MARQUEE, 'Filler'), away: team(NON_MARQUEE, 'Filler 2') }),
      fixture({ id: 3, kickoff_utc: '2026-08-15T12:00:00Z', home: team(81, 'Barcelona'), away: team(NON_MARQUEE, 'Filler') }),
    ];
    const selected = selectMarqueeFixtures(fixtures, 2);
    expect(selected.map((f) => f.id)).toEqual([1, 3]);
  });

  it('tops up with the soonest remaining fixtures when fewer than `count` qualify, never leaving the section thin', () => {
    const fixtures = [
      fixture({ id: 1, kickoff_utc: '2026-08-15T10:00:00Z', home: team(REAL_MADRID, 'Real Madrid'), away: team(NON_MARQUEE, 'Filler') }),
      fixture({ id: 2, kickoff_utc: '2026-08-15T11:00:00Z', home: team(NON_MARQUEE, 'Filler'), away: team(NON_MARQUEE, 'Filler 2') }),
      fixture({ id: 3, kickoff_utc: '2026-08-15T12:00:00Z', home: team(NON_MARQUEE, 'Filler'), away: team(NON_MARQUEE, 'Filler 3') }),
    ];
    // Only fixture 1 qualifies; count=3 must still return all 3, chronological.
    const selected = selectMarqueeFixtures(fixtures, 3);
    expect(selected.map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it('returns an empty list for an empty input rather than throwing', () => {
    expect(selectMarqueeFixtures([], 8)).toEqual([]);
  });

  it('never exceeds `count` even when every fixture qualifies', () => {
    const fixtures = [
      fixture({ id: 1, kickoff_utc: '2026-08-15T10:00:00Z', home: team(REAL_MADRID, 'Real Madrid'), away: team(81, 'Barcelona') }),
      fixture({ id: 2, kickoff_utc: '2026-08-15T11:00:00Z', home: team(64, 'Liverpool'), away: team(57, 'Arsenal') }),
      fixture({ id: 3, kickoff_utc: '2026-08-15T12:00:00Z', home: team(5, 'Bayern'), away: team(4, 'Dortmund') }),
    ];
    expect(selectMarqueeFixtures(fixtures, 2)).toHaveLength(2);
  });
});
