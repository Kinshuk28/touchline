import { describe, it, expect } from 'vitest';
import { parseLeagueCodes, resolveLeagueIds, hrefForLeagueFilter } from '@/lib/site/leagueFilter';
import type { LeagueRow } from '@/lib/site/rows';

const leagues: LeagueRow[] = [
  { id: 1, fd_code: 'PL', slug: 'premier-league', name: 'Premier League', country: 'England', emblem_url: null, current_season: 2026 },
  { id: 2, fd_code: 'PD', slug: 'la-liga', name: 'La Liga', country: 'Spain', emblem_url: null, current_season: 2026 },
];

describe('parseLeagueCodes', () => {
  it('splits a comma-separated leagues value', () => {
    expect(parseLeagueCodes('PD,SA')).toEqual(['PD', 'SA']);
  });

  it('treats an absent value as no filter', () => {
    expect(parseLeagueCodes(undefined)).toEqual([]);
    expect(parseLeagueCodes(null)).toEqual([]);
  });

  it('treats an empty value as no filter', () => {
    expect(parseLeagueCodes('')).toEqual([]);
  });

  it('drops empty segments from a trailing comma', () => {
    expect(parseLeagueCodes('PD,')).toEqual(['PD']);
  });
});

describe('resolveLeagueIds', () => {
  it('resolves known codes to ids', () => {
    expect(resolveLeagueIds(leagues, ['PD'])).toEqual([2]);
  });

  it('an unknown code resolves to no ids, not every id', () => {
    expect(resolveLeagueIds(leagues, ['XYZ'])).toEqual([]);
  });

  it('drops only the unrecognised code, keeping the recognised ones', () => {
    expect(resolveLeagueIds(leagues, ['PD', 'XYZ'])).toEqual([2]);
  });

  it('an empty codes list resolves to no ids', () => {
    expect(resolveLeagueIds(leagues, [])).toEqual([]);
  });
});

// Finding 3: this is the pure logic extracted from <LeagueFilter>'s inline
// `hrefFor`, which previously lived inside a component with no test at all.
describe('hrefForLeagueFilter', () => {
  it('adds a league to an empty selection', () => {
    expect(hrefForLeagueFilter('/scores', [], 'PD')).toBe('/scores?leagues=PD');
  });

  it('adds a league to an existing selection, keeping the others', () => {
    expect(hrefForLeagueFilter('/scores', ['PL'], 'PD')).toBe('/scores?leagues=PL,PD');
  });

  it('removes one of several selected leagues, keeping the rest', () => {
    expect(hrefForLeagueFilter('/scores', ['PL', 'PD', 'SA'], 'PD')).toBe('/scores?leagues=PL,SA');
  });

  it('removing the last selected league collapses to the bare basePath, no query string', () => {
    expect(hrefForLeagueFilter('/scores', ['PD'], 'PD')).toBe('/scores');
  });

  it('the "All" pill (code null) always returns basePath, regardless of the current selection', () => {
    expect(hrefForLeagueFilter('/scores', [], null)).toBe('/scores');
    expect(hrefForLeagueFilter('/scores', ['PL', 'PD'], null)).toBe('/scores');
  });

  it('respects a non-default basePath', () => {
    expect(hrefForLeagueFilter('/calendar', [], 'SA')).toBe('/calendar?leagues=SA');
    expect(hrefForLeagueFilter('/calendar', ['SA'], 'SA')).toBe('/calendar');
  });
});
