import type { RateLimiter } from '@/lib/ingest/rateLimiter';
import type {
  LeagueCode, FixtureStatus, RawFixture, RawStanding,
  RawSquadMember, RawScorer, RawTeam,
} from '@/lib/providers/types';

const BASE = 'https://api.football-data.org/v4';

export interface FootballDataOptions {
  apiKey: string;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
}

export class FootballDataClient {
  private readonly apiKey: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FootballDataOptions) {
    this.apiKey = opts.apiKey;
    this.limiter = opts.limiter;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    await this.limiter.acquire();
    const res = await this.fetchImpl(`${BASE}${path}`, {
      headers: { 'X-Auth-Token': this.apiKey },
    });
    this.limiter.syncFromHeaders(res.headers);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`football-data.org ${res.status} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async getMatches(code: LeagueCode, season: number): Promise<RawFixture[]> {
    const data = await this.get<{ matches?: unknown[] }>(
      `/competitions/${code}/matches?season=${season}`,
    );
    return (data.matches ?? []).map((m) => mapFixture(m as FdMatch, code, season));
  }

  async getStandings(code: LeagueCode, season: number): Promise<RawStanding[]> {
    const data = await this.get<{ standings?: FdStandingGroup[] }>(
      `/competitions/${code}/standings?season=${season}`,
    );
    const total = (data.standings ?? []).find((g) => g.type === 'TOTAL') ?? data.standings?.[0];
    return (total?.table ?? []).map((r) => ({
      teamFdId: r.team.id,
      teamName: r.team.name,
      teamShortName: r.team.shortName ?? null,
      teamTla: r.team.tla ?? null,
      teamCrestUrl: r.team.crest ?? null,
      position: r.position,
      played: r.playedGames,
      won: r.won,
      drawn: r.draw,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDifference: r.goalDifference,
      points: r.points,
      form: r.form ?? null,
    }));
  }

  /**
   * The full current roster of clubs in a competition — the free tier's
   * only reliable per-club metadata source. Unlike `/teams/{id}`, this
   * endpoint does not 403 for clubs still in the competition, but it also
   * never lists a club that has dropped out of every competition the free
   * tier covers (e.g. relegated at the end of last season) — those must be
   * sourced from `getStandings` instead. The `squad` array on each entry is
   * always empty here; this call is metadata-only.
   */
  async getCompetitionTeams(code: LeagueCode): Promise<RawTeam[]> {
    const data = await this.get<{ teams?: FdTeam[] }>(`/competitions/${code}/teams`);
    return (data.teams ?? []).map((t) => ({
      fdId: t.id,
      name: t.name,
      shortName: t.shortName ?? null,
      tla: t.tla ?? null,
      crestUrl: t.crest ?? null,
      venue: t.venue ?? null,
      founded: t.founded ?? null,
      clubColors: t.clubColors ?? null,
    }));
  }

  async getSquad(teamFdId: number): Promise<{ team: RawTeam; squad: RawSquadMember[] }> {
    const t = await this.get<FdTeam>(`/teams/${teamFdId}`);
    return {
      team: {
        fdId: t.id,
        name: t.name,
        shortName: t.shortName ?? null,
        tla: t.tla ?? null,
        crestUrl: t.crest ?? null,
        venue: t.venue ?? null,
        founded: t.founded ?? null,
        clubColors: t.clubColors ?? null,
      },
      squad: (t.squad ?? []).map((p) => ({
        fdId: p.id,
        name: p.name,
        position: p.position ?? null,
        nationality: p.nationality ?? null,
        dateOfBirth: p.dateOfBirth ?? null,
      })),
    };
  }

  async getScorers(code: LeagueCode, season: number): Promise<RawScorer[]> {
    const data = await this.get<{ scorers?: FdScorer[] }>(
      // limit=100 (the API's actual ceiling, confirmed live) rather than 50:
      // for La Liga and Serie A — where `getSquad` returns an empty array
      // for every club — this scorers list is the ONLY source of players at
      // all, so doubling it doubles the entire player roster those two
      // leagues get.
      `/competitions/${code}/scorers?season=${season}&limit=100`,
    );
    return (data.scorers ?? []).map((s) => ({
      playerFdId: s.player.id,
      playerName: s.player.name,
      teamFdId: s.team.id,
      goals: s.goals ?? null,
      assists: s.assists ?? null,
      playedMatches: s.playedMatches ?? null,
      firstName: s.player.firstName ?? null,
      lastName: s.player.lastName ?? null,
      dateOfBirth: s.player.dateOfBirth ?? null,
      nationality: s.player.nationality ?? null,
      position: s.player.position ?? null,
      shirtNumber: s.player.shirtNumber ?? null,
    }));
  }
}

function mapFixture(m: FdMatch, code: LeagueCode, season: number): RawFixture {
  return {
    fdId: m.id,
    leagueCode: code,
    season,
    kickoffUtc: m.utcDate,
    status: m.status as FixtureStatus,
    matchday: m.matchday ?? null,
    homeTeamFdId: m.homeTeam.id,
    awayTeamFdId: m.awayTeam.id,
    homeGoals: m.score?.fullTime?.home ?? null,
    awayGoals: m.score?.fullTime?.away ?? null,
    halfTimeHome: m.score?.halfTime?.home ?? null,
    halfTimeAway: m.score?.halfTime?.away ?? null,
    lastUpdated: m.lastUpdated ?? null,
  };
}

interface FdMatch {
  id: number; utcDate: string; status: string; matchday?: number;
  homeTeam: { id: number }; awayTeam: { id: number };
  score?: { fullTime?: { home: number | null; away: number | null };
            halfTime?: { home: number | null; away: number | null } };
  lastUpdated?: string;
}
interface FdStandingGroup {
  type: string;
  table: Array<{
    position: number;
    team: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
    playedGames: number; won: number;
    draw: number; lost: number; goalsFor: number; goalsAgainst: number;
    goalDifference: number; points: number; form?: string | null;
  }>;
}
interface FdTeam {
  id: number; name: string; shortName?: string; tla?: string; crest?: string;
  venue?: string; founded?: number; clubColors?: string;
  squad?: Array<{ id: number; name: string; position?: string; nationality?: string; dateOfBirth?: string }>;
}
interface FdScorer {
  player: {
    id: number; name: string;
    firstName?: string | null; lastName?: string | null;
    dateOfBirth?: string | null; nationality?: string | null;
    position?: string | null; shirtNumber?: number | null;
  };
  team: { id: number };
  goals?: number | null; assists?: number | null; playedMatches?: number | null;
}
