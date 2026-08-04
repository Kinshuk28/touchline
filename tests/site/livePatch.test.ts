import { describe, it, expect } from 'vitest';
import { mergeLiveFixtures } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const base: FixtureWithTeams = {
  id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
  status: 'IN_PLAY', matchday: 1, home_goals: 0, away_goals: 0,
  updated_at: '2026-08-16T14:30:00Z',
  home: { id: 10, slug: 'a', name: 'A', short_name: 'A', tla: 'AAA', crest_url: null },
  away: { id: 11, slug: 'b', name: 'B', short_name: 'B', tla: 'BBB', crest_url: null },
};

describe('mergeLiveFixtures', () => {
  it('updates the score of a matching fixture', () => {
    const out = mergeLiveFixtures([base], [{ ...base, home_goals: 1 }]);
    expect(out[0]!.home_goals).toBe(1);
  });

  it('preserves joined team data the server still sends back', () => {
    const patched = { ...base, home_goals: 2, away_goals: 1 };
    const out = mergeLiveFixtures([base], [patched]);
    expect(out[0]!.home!.name).toBe('A');
    expect(out[0]!.away!.slug).toBe('b');
  });

  it('leaves an unchanged fixture untouched, by identity', () => {
    const other = { ...base, id: 2 };
    const changed = { ...base, home_goals: 3 };
    const out = mergeLiveFixtures([base, other], [changed, other]);
    expect(out.find((f) => f.id === 2)).toBe(other);
  });

  it('appends a fixture the page has not seen yet', () => {
    const kickedOff: FixtureWithTeams = {
      ...base,
      id: 42,
      kickoff_utc: '2026-08-16T15:00:00Z',
      home: { id: 20, slug: 'c', name: 'C', short_name: 'C', tla: 'CCC', crest_url: null },
      away: { id: 21, slug: 'd', name: 'D', short_name: 'D', tla: 'DDD', crest_url: null },
    };
    const out = mergeLiveFixtures([base], [base, kickedOff]);
    expect(out.some((f) => f.id === 42)).toBe(true);
    expect(out.find((f) => f.id === 42)?.home?.name).toBe('C');
  });

  it('removes a fixture the server no longer returns', () => {
    const other = { ...base, id: 2 };
    const out = mergeLiveFixtures([base, other], [base]);
    expect(out.some((f) => f.id === 2)).toBe(false);
    expect(out).toHaveLength(1);
  });

  it('carries a status transition through to full time', () => {
    const out = mergeLiveFixtures([base], [{ ...base, status: 'FINISHED', home_goals: 2, away_goals: 2 }]);
    expect(out[0]!.status).toBe('FINISHED');
  });

  it('accepts a null score without coercing it to zero', () => {
    const out = mergeLiveFixtures([base], [{ ...base, status: 'POSTPONED', home_goals: null, away_goals: null }]);
    expect(out[0]!.home_goals).toBeNull();
  });

  it('keeps the result ordered by kickoff_utc ascending, matching the server', () => {
    const earlier: FixtureWithTeams = { ...base, id: 99, kickoff_utc: '2026-08-16T12:00:00Z' };
    const out = mergeLiveFixtures([base], [base, earlier]);
    expect(out.map((f) => f.id)).toEqual([99, 1]);
  });
});
