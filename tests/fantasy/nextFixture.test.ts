import { describe, it, expect } from 'vitest';
import { nextFixtureByTeam } from '@/lib/fantasy/nextFixture';
import type { FixtureWithTeams } from '@/lib/site/rows';

function team(id: number, tla: string) {
  return { id, fd_id: id, slug: tla.toLowerCase(), name: `${tla} FC`, short_name: tla, tla, crest_url: null, club_colors: null, venue: null };
}

function fixture(
  id: number,
  home: ReturnType<typeof team> | null,
  away: ReturnType<typeof team> | null,
  kickoffUtc: string,
): FixtureWithTeams {
  return {
    id, league_id: 14, season: 2026, kickoff_utc: kickoffUtc, status: 'SCHEDULED', matchday: null,
    home_goals: null, away_goals: null, updated_at: kickoffUtc, home, away,
  };
}

const ARS = team(1, 'ARS');
const CHE = team(2, 'CHE');
const LIV = team(3, 'LIV');
const MUN = team(4, 'MUN');

describe('nextFixtureByTeam', () => {
  it('gives each club its soonest fixture, home or away', () => {
    const fixtures = [
      fixture(1, ARS, CHE, '2026-08-15T14:00:00Z'),
      fixture(2, LIV, MUN, '2026-08-16T14:00:00Z'),
    ];
    const map = nextFixtureByTeam(fixtures);
    expect(map.get(ARS.id)).toEqual({ opponentTla: 'CHE', opponentName: 'CHE', home: true, kickoffUtc: '2026-08-15T14:00:00Z' });
    expect(map.get(CHE.id)).toEqual({ opponentTla: 'ARS', opponentName: 'ARS', home: false, kickoffUtc: '2026-08-15T14:00:00Z' });
    expect(map.get(MUN.id)).toEqual({ opponentTla: 'LIV', opponentName: 'LIV', home: false, kickoffUtc: '2026-08-16T14:00:00Z' });
  });

  it('takes the first fixture it sees per club and ignores later ones — the list must already be soonest-first', () => {
    const fixtures = [
      fixture(1, ARS, CHE, '2026-08-15T14:00:00Z'),
      fixture(2, ARS, LIV, '2026-08-22T14:00:00Z'),
    ];
    expect(nextFixtureByTeam(fixtures).get(ARS.id)?.opponentTla).toBe('CHE');
  });

  it('names the opponent even when its own team row is missing, from whichever side is known', () => {
    const fixtures = [fixture(1, ARS, null, '2026-08-15T14:00:00Z')];
    expect(nextFixtureByTeam(fixtures).get(ARS.id)).toEqual({ opponentTla: null, opponentName: 'TBC', home: true, kickoffUtc: '2026-08-15T14:00:00Z' });
  });

  it('is empty for no fixtures', () => {
    expect(nextFixtureByTeam([]).size).toBe(0);
  });

  it('does not crash on an `undefined` team — only the type promises `null`', () => {
    // An unresolved embed from a real response should be `null`, but this
    // guards the case where it comes back `undefined` instead: `undefined
    // !== null` is `true` in JS, so a strict-equality check would sail
    // straight past this and crash on `.id` — exactly what a stray
    // `as FixtureWithTeams` cast lets slip past the type checker.
    const withUndefinedAway = { ...fixture(1, ARS, CHE, '2026-08-15T14:00:00Z'), away: undefined } as unknown as FixtureWithTeams;
    expect(() => nextFixtureByTeam([withUndefinedAway])).not.toThrow();
    expect(nextFixtureByTeam([withUndefinedAway]).get(ARS.id)).toEqual({
      opponentTla: null, opponentName: 'TBC', home: true, kickoffUtc: '2026-08-15T14:00:00Z',
    });
  });
});
