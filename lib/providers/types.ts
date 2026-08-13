export type LeagueCode = 'PL' | 'PD' | 'SA' | 'BL1' | 'FL1' | 'CL';

export const LEAGUE_CODES: LeagueCode[] = ['PL', 'PD', 'SA', 'BL1', 'FL1'];

/**
 * Codes that are genuinely one club-per-competition (a domestic league) vs.
 * a continental competition a club enters *in addition to* its domestic
 * league. `LEAGUE_CODES` deliberately excludes 'CL': every ingest path that
 * writes `teams.league_id` (a single, domestic-only column — see
 * lib/db/repositories/teams.ts) iterates `LEAGUE_CODES`, and Real Madrid
 * being both a La Liga and a Champions League club must never make one
 * ingest run overwrite the other. `CONTINENTAL_LEAGUE_CODES` is the
 * separate list for competitions handled through `league_teams`
 * (many-to-many) instead.
 */
export const CONTINENTAL_LEAGUE_CODES: LeagueCode[] = ['CL'];

/** football-data.org match statuses, verbatim. */
export type FixtureStatus =
  | 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED'
  | 'FINISHED' | 'POSTPONED' | 'SUSPENDED' | 'CANCELLED' | 'AWARDED';

export const IN_PLAY_STATUSES: FixtureStatus[] = ['IN_PLAY', 'PAUSED'];

export interface RawTeam {
  fdId: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
  venue: string | null;
  founded: number | null;
  clubColors: string | null;
}

export interface RawFixture {
  fdId: number;
  leagueCode: LeagueCode;
  season: number;
  kickoffUtc: string;
  status: FixtureStatus;
  matchday: number | null;
  homeTeamFdId: number;
  awayTeamFdId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  halfTimeHome: number | null;
  halfTimeAway: number | null;
  lastUpdated: string | null;
}

export interface RawStanding {
  teamFdId: number;
  /**
   * Club identity fields embedded directly in the standings row's `team`
   * object. Present for every row, including clubs relegated out of every
   * competition the free tier covers (which would otherwise 403 on
   * `/teams/{id}`) — this is the zero-extra-request source of their
   * identity for the historical clubs table.
   */
  teamName: string;
  teamShortName: string | null;
  teamTla: string | null;
  teamCrestUrl: string | null;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string | null;
}

export interface RawSquadMember {
  fdId: number;
  name: string;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
}

export interface RawScorer {
  playerFdId: number;
  playerName: string;
  teamFdId: number;
  goals: number | null;
  assists: number | null;
  playedMatches: number | null;
  /**
   * Bio fields carried on the scorer's embedded `player` object. This is the
   * only per-player source available at all for La Liga and Serie A (see
   * `getSquad`'s doc comment — their squads come back empty), so these are
   * nullable: not every entry is guaranteed to populate every field, and a
   * missing value must be stored as `null`, never invented.
   */
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  position: string | null;
  shirtNumber: number | null;
}
