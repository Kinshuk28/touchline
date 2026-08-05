import { describe, it, expect } from 'vitest';
import {
  seasonLabel, isUnplayedSeason, sortStandingsForDisplay, formatGoalDifference, parseForm,
} from '@/lib/site/standingsDisplay';
import type { StandingRow } from '@/lib/site/rows';

function row(overrides: Partial<StandingRow> & { team_id: number }): StandingRow {
  return {
    league_id: 1,
    season: 2025,
    position: overrides.team_id,
    played: 38,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
    form: null,
    updated_at: '2026-05-01T00:00:00Z',
    team: null,
    ...overrides,
  };
}

describe('seasonLabel', () => {
  it('renders a starting year as a two-year campaign label', () => {
    expect(seasonLabel(2025)).toBe('2025-26');
  });

  it('rolls the second year over at a century boundary', () => {
    expect(seasonLabel(2099)).toBe('2099-00');
  });
});

describe('isUnplayedSeason', () => {
  it('is true when every row has played 0 matches', () => {
    const rows = [row({ team_id: 1, played: 0 }), row({ team_id: 2, played: 0 })];
    expect(isUnplayedSeason(rows)).toBe(true);
  });

  it('is false when at least one row has played a match — the season is under way', () => {
    const rows = [row({ team_id: 1, played: 0 }), row({ team_id: 2, played: 1 })];
    expect(isUnplayedSeason(rows)).toBe(false);
  });

  it('is false for an empty array — nothing to honestly call "unplayed"', () => {
    expect(isUnplayedSeason([])).toBe(false);
  });
});

describe('sortStandingsForDisplay', () => {
  it('sorts a played season by stored position, ascending', () => {
    const rows = [
      row({ team_id: 1, position: 3, played: 10 }),
      row({ team_id: 2, position: 1, played: 10 }),
      row({ team_id: 3, position: 2, played: 10 }),
    ];
    expect(sortStandingsForDisplay(rows).map((r) => r.team_id)).toEqual([2, 3, 1]);
  });

  // The live table's unplayed-season rows carry a stored `position` that is
  // neither alphabetical nor a real ranking (verified against production
  // data) — trusting it would present an arbitrary order as if it meant
  // something. Sorting alphabetically by club name instead is honest: it
  // reads as a list, not a table.
  it('ignores stored position for an unplayed season and sorts by club name instead', () => {
    const rows = [
      row({ team_id: 1, position: 1, played: 0, team: { id: 1, fd_id: 1, slug: 'z', name: 'Zeta FC', short_name: null, tla: null, crest_url: null, club_colors: null, venue: null } }),
      row({ team_id: 2, position: 2, played: 0, team: { id: 2, fd_id: 2, slug: 'a', name: 'Alpha FC', short_name: null, tla: null, crest_url: null, club_colors: null, venue: null } }),
    ];
    expect(sortStandingsForDisplay(rows).map((r) => r.team_id)).toEqual([2, 1]);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ team_id: 1, position: 2 }), row({ team_id: 2, position: 1 })];
    const original = [...rows];
    sortStandingsForDisplay(rows);
    expect(rows).toEqual(original);
  });
});

describe('formatGoalDifference', () => {
  it('prefixes a positive value with +', () => {
    expect(formatGoalDifference(15)).toBe('+15');
  });

  it('leaves zero unprefixed', () => {
    expect(formatGoalDifference(0)).toBe('0');
  });

  it('leaves a negative value as-is (the minus sign is already there)', () => {
    expect(formatGoalDifference(-8)).toBe('-8');
  });
});

describe('parseForm', () => {
  it('parses a comma-separated result string into letters', () => {
    expect(parseForm('W,D,L,W,W')).toEqual(['W', 'D', 'L', 'W', 'W']);
  });

  it('returns null for null', () => {
    expect(parseForm(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseForm(undefined)).toBeNull();
  });

  // The live table stores '' (not null) for the 96 not-yet-played rows —
  // both must read as "nothing to show", not just the null case.
  it('returns null for an empty string', () => {
    expect(parseForm('')).toBeNull();
  });

  it('drops a token that is not W, D, or L rather than rendering it', () => {
    expect(parseForm('W,X,L')).toEqual(['W', 'L']);
  });

  it('is case-insensitive', () => {
    expect(parseForm('w,d,l')).toEqual(['W', 'D', 'L']);
  });
});
