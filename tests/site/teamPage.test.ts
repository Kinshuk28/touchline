import { describe, it, expect } from 'vitest';
import { splitTeamFixtures, teamRecord } from '@/lib/site/teamPage';
import { groupSquadByPosition, squadGroupOf } from '@/lib/site/squad';
import type { FixtureWithTeams, TeamLite } from '@/lib/site/rows';
import type { SquadPlayer } from '@/lib/site/queries/players';

function team(id: number, name: string): TeamLite {
  return {
    id, fd_id: id, slug: `t-${id}`, name, short_name: name, tla: null,
    crest_url: null, club_colors: null, venue: null,
  };
}

const ARSENAL = team(1, 'Arsenal');
const CHELSEA = team(2, 'Chelsea');
const SPURS = team(3, 'Tottenham');

function fixture(overrides: Partial<FixtureWithTeams> & { id: number; kickoff_utc: string }): FixtureWithTeams {
  return {
    league_id: 14,
    season: 2026,
    status: 'TIMED',
    matchday: 1,
    home_goals: null,
    away_goals: null,
    half_time_home: null,
    half_time_away: null,
    updated_at: '2026-08-06T00:00:00Z',
    home: ARSENAL,
    away: CHELSEA,
    ...overrides,
  };
}

describe('splitTeamFixtures', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('puts played matches in results newest-first and future ones in upcoming soonest-first', () => {
    const list = [
      fixture({ id: 1, kickoff_utc: '2026-08-10T14:00:00Z' }),
      fixture({ id: 2, kickoff_utc: '2026-08-17T14:00:00Z' }),
      fixture({ id: 3, kickoff_utc: '2026-08-24T14:00:00Z' }),
      fixture({ id: 4, kickoff_utc: '2026-08-31T14:00:00Z' }),
    ];
    const { results, upcoming } = splitTeamFixtures(list, now);
    expect(results.map((f) => f.id)).toEqual([2, 1]);
    expect(upcoming.map((f) => f.id)).toEqual([3, 4]);
  });

  it('splits on kickoff time, not status — a kicked-off match whose status has not caught up still lands in results', () => {
    // The gap the fixtures query's grace window exists for: kickoff passed,
    // status still TIMED. A status-based split would lose this match from
    // both lists.
    const list = [fixture({ id: 1, kickoff_utc: '2026-08-20T11:00:00Z', status: 'TIMED' })];
    const { results, upcoming } = splitTeamFixtures(list, now);
    expect(results.map((f) => f.id)).toEqual([1]);
    expect(upcoming).toEqual([]);
  });

  it('applies each limit independently', () => {
    const list = [
      fixture({ id: 1, kickoff_utc: '2026-08-01T14:00:00Z' }),
      fixture({ id: 2, kickoff_utc: '2026-08-08T14:00:00Z' }),
      fixture({ id: 3, kickoff_utc: '2026-08-15T14:00:00Z' }),
      fixture({ id: 4, kickoff_utc: '2026-08-25T14:00:00Z' }),
      fixture({ id: 5, kickoff_utc: '2026-08-26T14:00:00Z' }),
    ];
    const { results, upcoming } = splitTeamFixtures(list, now, { results: 2, upcoming: 1 });
    expect(results.map((f) => f.id)).toEqual([3, 2]);
    expect(upcoming.map((f) => f.id)).toEqual([4]);
  });

  it('handles a club with nothing played and nothing scheduled', () => {
    expect(splitTeamFixtures([], now)).toEqual({ results: [], upcoming: [] });
  });
});

describe('teamRecord', () => {
  const played = (id: number, home: TeamLite, away: TeamLite, hg: number, ag: number) =>
    fixture({ id, kickoff_utc: '2026-08-10T14:00:00Z', home, away, home_goals: hg, away_goals: ag, status: 'FINISHED' });

  it('counts wins, draws and losses from the club\'s own side of the scoreline', () => {
    const list = [
      played(1, ARSENAL, CHELSEA, 3, 1),   // home win
      played(2, SPURS, ARSENAL, 0, 2),     // away win
      played(3, ARSENAL, SPURS, 1, 1),     // draw
      played(4, CHELSEA, ARSENAL, 2, 0),   // away loss
    ];
    expect(teamRecord(list, ARSENAL.id, 2026)).toEqual({
      played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 6, goalsAgainst: 4,
    });
  });

  it('ignores fixtures with no score — a scheduled match is not a nil-nil', () => {
    const list = [
      played(1, ARSENAL, CHELSEA, 2, 0),
      fixture({ id: 2, kickoff_utc: '2026-08-24T14:00:00Z' }),
    ];
    expect(teamRecord(list, ARSENAL.id, 2026)?.played).toBe(1);
  });

  it('returns null when nothing has been played, rather than a record of zeros', () => {
    expect(teamRecord([fixture({ id: 1, kickoff_utc: '2026-08-24T14:00:00Z' })], ARSENAL.id, 2026)).toBeNull();
    expect(teamRecord([], ARSENAL.id, 2026)).toBeNull();
  });

  it('ignores a fixture the club is not in', () => {
    expect(teamRecord([played(1, CHELSEA, SPURS, 1, 0)], ARSENAL.id, 2026)).toBeNull();
  });

  // The bug this parameter exists to make impossible: getFixturesForTeam
  // (the only real caller) returns every season this project has ever
  // stored for a club, not just one. Confirmed live on /team/liverpool-fc-64
  // showing "Played 40" a few matchdays into a new season — every one of
  // last season's 38 games summed in alongside this season's handful,
  // because the record used to have no season filter at all.
  it('never mixes another season\'s results into the count, even a full one', () => {
    const lastSeason = (id: number, hg: number, ag: number) =>
      fixture({
        id, kickoff_utc: '2025-09-01T14:00:00Z', season: 2025, status: 'FINISHED',
        home: ARSENAL, away: CHELSEA, home_goals: hg, away_goals: ag,
      });
    const list = [
      ...Array.from({ length: 38 }, (_, i) => lastSeason(100 + i, 2, 0)), // a full, finished 2025 season
      played(1, ARSENAL, CHELSEA, 1, 0), // one 2026 result
    ];
    expect(teamRecord(list, ARSENAL.id, 2026)).toEqual({
      played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 1, goalsAgainst: 0,
    });
  });

  it('returns null for the current season even when a past season has a full record', () => {
    const list = [
      fixture({
        id: 1, kickoff_utc: '2025-09-01T14:00:00Z', season: 2025, status: 'FINISHED',
        home: ARSENAL, away: CHELSEA, home_goals: 2, away_goals: 0,
      }),
    ];
    expect(teamRecord(list, ARSENAL.id, 2026)).toBeNull();
  });
});

describe('squadGroupOf', () => {
  it.each([
    ['Goalkeeper', 'Goalkeepers'],
    ['GKP', 'Goalkeepers'],
    ['Centre-Back', 'Defenders'],
    ['Left-Back', 'Defenders'],
    ['DEF', 'Defenders'],
    ['Central Midfield', 'Midfielders'],
    ['MID', 'Midfielders'],
    ['Centre-Forward', 'Forwards'],
    ['Left Winger', 'Forwards'],
    ['FWD', 'Forwards'],
  ])('maps %j to %s', (position, group) => {
    expect(squadGroupOf(position)).toBe(group);
  });

  it('files "Defensive Midfield" as a midfielder, not a defender', () => {
    // Whole-word matching, checked midfield-first: a substring test for
    // "def" is exactly how this goes wrong.
    expect(squadGroupOf('Defensive Midfield')).toBe('Midfielders');
  });

  it('never guesses at an unknown or missing position', () => {
    expect(squadGroupOf(null)).toBe('Position not recorded');
    expect(squadGroupOf('')).toBe('Position not recorded');
    expect(squadGroupOf('Utility')).toBe('Position not recorded');
  });
});

describe('groupSquadByPosition', () => {
  const player = (id: number, name: string, position: string | null): SquadPlayer => ({
    id, slug: `p-${id}`, name, position, nationality: null,
  });

  it('orders groups conventionally and drops empty ones', () => {
    const squad = [
      player(1, 'A Striker', 'Centre-Forward'),
      player(2, 'A Keeper', 'Goalkeeper'),
      player(3, 'A Defender', 'Centre-Back'),
    ];
    expect(groupSquadByPosition(squad).map((g) => g.group)).toEqual(['Goalkeepers', 'Defenders', 'Forwards']);
  });

  it('preserves the order players arrive in within a group', () => {
    const squad = [
      player(1, 'Adams', 'Centre-Back'),
      player(2, 'Brown', 'Left-Back'),
    ];
    expect(groupSquadByPosition(squad)[0]?.players.map((p) => p.name)).toEqual(['Adams', 'Brown']);
  });

  it('keeps unplaceable players in the squad rather than dropping them', () => {
    const squad = [player(1, 'Someone', null), player(2, 'A Keeper', 'Goalkeeper')];
    const groups = groupSquadByPosition(squad);
    expect(groups.flatMap((g) => g.players).length).toBe(2);
    expect(groups.at(-1)?.group).toBe('Position not recorded');
  });

  it('returns nothing for an empty squad', () => {
    expect(groupSquadByPosition([])).toEqual([]);
  });
});
