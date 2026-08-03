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
      `/competitions/${code}/scorers?season=${season}&limit=50`,
    );
    return (data.scorers ?? []).map((s) => ({
      playerFdId: s.player.id,
      playerName: s.player.name,
      teamFdId: s.team.id,
      goals: s.goals ?? null,
      assists: s.assists ?? null,
      playedMatches: s.playedMatches ?? null,
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
    position: number; team: { id: number }; playedGames: number; won: number;
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
  player: { id: number; name: string }; team: { id: number };
  goals?: number | null; assists?: number | null; playedMatches?: number | null;
}
