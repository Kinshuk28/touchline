import { describe, it, expect } from 'vitest';
import { applyPatches } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const base: FixtureWithTeams = {
  id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
  status: 'IN_PLAY', matchday: 1, home_goals: 0, away_goals: 0,
  updated_at: '2026-08-16T14:30:00Z',
  home: { id: 10, slug: 'a', name: 'A', short_name: 'A', tla: 'AAA', crest_url: null },
  away: { id: 11, slug: 'b', name: 'B', short_name: 'B', tla: 'BBB', crest_url: null },
};

describe('applyPatches', () => {
  it('updates the score of a matching fixture', () => {
    const out = applyPatches([base], [{ id: 1, status: 'IN_PLAY', home_goals: 1, away_goals: 0, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBe(1);
  });

  it('preserves joined team data the patch does not carry', () => {
    const out = applyPatches([base], [{ id: 1, status: 'IN_PLAY', home_goals: 2, away_goals: 1, updated_at: 'x' }]);
    expect(out[0]!.home!.name).toBe('A');
    expect(out[0]!.away!.slug).toBe('b');
  });

  it('leaves fixtures with no patch untouched, by identity', () => {
    const other = { ...base, id: 2 };
    const out = applyPatches([base, other], [{ id: 1, status: 'IN_PLAY', home_goals: 3, away_goals: 0, updated_at: 'x' }]);
    expect(out[1]).toBe(other);
  });

  it('ignores a patch for a fixture not on the page', () => {
    const out = applyPatches([base], [{ id: 999, status: 'IN_PLAY', home_goals: 9, away_goals: 9, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBe(0);
    expect(out).toHaveLength(1);
  });

  it('carries a status transition through to full time', () => {
    const out = applyPatches([base], [{ id: 1, status: 'FINISHED', home_goals: 2, away_goals: 2, updated_at: 'x' }]);
    expect(out[0]!.status).toBe('FINISHED');
  });

  it('accepts a null score without coercing it to zero', () => {
    const out = applyPatches([base], [{ id: 1, status: 'POSTPONED', home_goals: null, away_goals: null, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBeNull();
  });
});
