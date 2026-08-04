import { describe, it, expect } from 'vitest';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
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
