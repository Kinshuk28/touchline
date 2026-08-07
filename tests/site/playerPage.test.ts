import { describe, it, expect } from 'vitest';
import { ageFrom, displayStats, hasAnyStat } from '@/lib/site/playerPage';
import type { PlayerSeasonStats } from '@/lib/site/queries/players';

function stats(overrides: Partial<PlayerSeasonStats> & { season: number; source: PlayerSeasonStats['source'] }): PlayerSeasonStats {
  return {
    league_id: 14,
    appearances: null, minutes: null, goals: null, assists: null,
    yellow_cards: null, red_cards: null,
    ...overrides,
  };
}

describe('ageFrom', () => {
  const now = new Date('2026-08-07T12:00:00Z');

  it('counts whole years', () => {
    expect(ageFrom('2000-08-06', now)).toBe(26);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageFrom('2000-08-08', now)).toBe(25);
    expect(ageFrom('2000-12-31', now)).toBe(25);
  });

  it('counts a birthday landing exactly today', () => {
    expect(ageFrom('2000-08-07', now)).toBe(26);
  });

  it('returns null rather than guessing when the date is missing or unusable', () => {
    expect(ageFrom(null, now)).toBeNull();
    expect(ageFrom('', now)).toBeNull();
    expect(ageFrom('not-a-date', now)).toBeNull();
  });

  it('rejects an implausible age instead of printing it', () => {
    expect(ageFrom('1820-01-01', now)).toBeNull();
    expect(ageFrom('2030-01-01', now)).toBeNull();
  });

  it('accepts a full timestamp, not just a date', () => {
    expect(ageFrom('2000-01-01T00:00:00Z', now)).toBe(26);
  });
});

describe('hasAnyStat', () => {
  it('is false for a row where every metric is null', () => {
    expect(hasAnyStat(stats({ season: 2025, source: 'fpl' }))).toBe(false);
  });

  it('is true when even one metric is present, including a real zero', () => {
    expect(hasAnyStat(stats({ season: 2025, source: 'fpl', goals: 0 }))).toBe(true);
    expect(hasAnyStat(stats({ season: 2025, source: 'fpl', minutes: 90 }))).toBe(true);
  });
});

describe('displayStats', () => {
  it('drops rows that carry no numbers at all', () => {
    const rows = [
      stats({ season: 2025, source: 'fpl' }),
      stats({ season: 2025, source: 'football-data', goals: 12 }),
    ];
    expect(displayStats(rows).map((r) => r.source)).toEqual(['football-data']);
  });

  it('orders newest season first', () => {
    const rows = [
      stats({ season: 2024, source: 'football-data', goals: 4 }),
      stats({ season: 2026, source: 'football-data', goals: 1 }),
      stats({ season: 2025, source: 'football-data', goals: 9 }),
    ];
    expect(displayStats(rows).map((r) => r.season)).toEqual([2026, 2025, 2024]);
  });

  it('puts the primary provider first within a season', () => {
    // football-data is the provider the rest of the site's fixtures,
    // standings and clubs come from, so its row leads.
    const rows = [
      stats({ season: 2025, source: 'fpl', minutes: 2400 }),
      stats({ season: 2025, source: 'football-data', goals: 9 }),
    ];
    expect(displayStats(rows).map((r) => r.source)).toEqual(['football-data', 'fpl']);
  });

  it('never merges two sources into one row', () => {
    const rows = [
      stats({ season: 2025, source: 'fpl', minutes: 2400, goals: 8 }),
      stats({ season: 2025, source: 'football-data', goals: 9 }),
    ];
    const out = displayStats(rows);
    expect(out).toHaveLength(2);
    // The two providers disagree (8 vs 9). Both stand as published; nothing
    // averages them into a figure neither ever reported.
    expect(out.map((r) => r.goals)).toEqual([9, 8]);
  });

  it('returns nothing for a player with no usable stats', () => {
    expect(displayStats([])).toEqual([]);
    expect(displayStats([stats({ season: 2025, source: 'fpl' })])).toEqual([]);
  });

  it('does not mutate the caller\'s array', () => {
    const rows = [
      stats({ season: 2024, source: 'fpl', goals: 1 }),
      stats({ season: 2026, source: 'fpl', goals: 2 }),
    ];
    displayStats(rows);
    expect(rows.map((r) => r.season)).toEqual([2024, 2026]);
  });
});
