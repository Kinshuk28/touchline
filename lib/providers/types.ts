export type LeagueCode = 'PL' | 'PD' | 'SA' | 'BL1' | 'FL1';

export const LEAGUE_CODES: LeagueCode[] = ['PL', 'PD', 'SA', 'BL1', 'FL1'];

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
}
