import type { RateLimiter } from '@/lib/ingest/rateLimiter';
import {
  LEAGUE_CODES,
  type LeagueCode, type FixtureStatus, type RawFixture, type RawStanding,
  type RawSquadMember, type RawScorer, type RawTeam, type RawMatchGoal,
} from '@/lib/providers/types';

const BASE = 'https://api.football-data.org/v4';

// Max attempts per request: the first try plus up to two retries. A 429
// means every key sharing this rate limit is contending for the same 10
// req/min ceiling (see lib/ingest/rateLimiter.ts) — a couple of retries,
// backed off per the provider's own reset hint, is enough to ride out a
// burst without turning a single flaky request into a long stall.
const MAX_ATTEMPTS = 3;

// Fallback wait when the provider doesn't send a usable reset hint. The
// window is 60s (see RateLimiter), so this is enough to guarantee at least
// one full refill before retrying again.
const FALLBACK_BACKOFF_MS = 60_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FootballDataOptions {
  apiKey: string;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  // 429 (rate limited) and 5xx (provider-side failure) are worth retrying.
  // Every other 4xx — most importantly 403, which the squads/backfill scripts
  // rely on to detect "this club isn't reachable on the free tier" — must
  // fail on the first attempt so that signal isn't delayed or masked.
  return status === 429 || (status >= 500 && status < 600);
}

export class FootballDataClient {
  private readonly apiKey: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: FootballDataOptions) {
    this.apiKey = opts.apiKey;
    this.limiter = opts.limiter;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Backoff for a retryable (429/5xx) response. For 429 specifically, the
   * provider's `X-RequestCounter-Reset` header gives the number of seconds
   * until its own counter resets — honouring that is far more accurate than
   * guessing, since a shared key (see the matchday 429 cascade this retry
   * logic exists to survive) may have been exhausted by a completely
   * different workflow moments ago. When the header is absent or
   * unparseable, fall back to a full window's wait so we don't hammer a
   * provider that's still over budget for reasons we can't see.
   */
  private backoffMs(res: Response, attempt: number): number {
    if (res.status === 429) {
      const raw = res.headers.get('X-RequestCounter-Reset');
      const resetSeconds = raw !== null ? Number.parseInt(raw, 10) : NaN;
      if (!Number.isNaN(resetSeconds) && resetSeconds >= 0) {
        return (resetSeconds + 1) * 1000;
      }
      return FALLBACK_BACKOFF_MS;
    }
    // 5xx: no reset semantics apply — a short, linearly increasing backoff
    // is enough to ride out a transient provider blip.
    return 1000 * attempt;
  }

  private async get<T>(path: string): Promise<T> {
    let lastStatus = 0;
    let lastBody = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.limiter.acquire();
      const res = await this.fetchImpl(`${BASE}${path}`, {
        headers: { 'X-Auth-Token': this.apiKey },
      });
      // Feed the limiter from every response, including failed ones — a 429
      // itself carries the most up-to-date view of how exhausted the shared
      // key currently is.
      this.limiter.syncFromHeaders(res.headers);

      if (res.ok) {
        return (await res.json()) as T;
      }

      lastStatus = res.status;
      lastBody = await res.text();

      if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(
          `football-data.org ${res.status} for ${path} (attempt ${attempt}/${MAX_ATTEMPTS}): ${lastBody.slice(0, 200)}`,
        );
      }

      await this.sleep(this.backoffMs(res, attempt));
    }

    // Unreachable: every loop iteration above either returns or throws. This
    // satisfies strict-mode control-flow analysis, which can't statically
    // prove that of a bounded `for` loop.
    throw new Error(
      `football-data.org ${lastStatus} for ${path}: exhausted ${MAX_ATTEMPTS} attempts: ${lastBody.slice(0, 200)}`,
    );
  }

  async getMatches(code: LeagueCode, season: number): Promise<RawFixture[]> {
    const data = await this.get<{ matches?: unknown[] }>(
      `/competitions/${code}/matches?season=${season}`,
    );
    return (data.matches ?? []).map((m) => mapFixture(m as FdMatch, code, season));
  }

  /**
   * Matches across every tracked league in one request, for the live-polling
   * job. `GET /v4/matches` (unlike `/competitions/{code}/matches`) accepts a
   * comma-separated `competitions` filter plus a `dateFrom`/`dateTo` window
   * and returns matches for all of them together — confirmed live on the
   * free tier, 2026-08-03: `?competitions=PL,PD,SA,BL1,FL1&dateFrom=...&dateTo=...`
   * returned 200 with matches tagged by `competition.code` across four of
   * the five codes requested (the fifth simply had no fixtures in that
   * window). This is what turns the live job's per-poll cost from 5 requests
   * (one full-season `getMatches` per league) into 1.
   *
   * The provider caps the `dateFrom`..`dateTo` span at 10 days — confirmed
   * live via a 400 `"Specified period must not exceed 10 days."` on a wider
   * probe — so callers must keep the window at or under that.
   *
   * Each match's league is resolved from its own `competition.code` rather
   * than assumed from the request, since a single response mixes leagues. A
   * code the response tags that isn't one of ours is skipped rather than
   * guessed at — defensive against the provider ever adding an unrelated
   * competition to a broad response.
   */
  async getMatchesAcrossLeagues(
    codes: LeagueCode[],
    dateFrom: string,
    dateTo: string,
    season: number,
  ): Promise<RawFixture[]> {
    const data = await this.get<{ matches?: FdMatchWithCompetition[] }>(
      `/matches?competitions=${codes.join(',')}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    );
    const out: RawFixture[] = [];
    for (const m of data.matches ?? []) {
      const code = m.competition?.code;
      if (code === undefined || !(LEAGUE_CODES as string[]).includes(code)) continue;
      out.push(mapFixture(m, code as LeagueCode, season));
    }
    return out;
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

  /**
   * Goal-by-goal detail for one match — "who scored," which the fixtures
   * this project already ingests can't answer (they carry only the final
   * score). Whether the free tier actually populates the `goals` array here
   * is untested by this project's own research; a 403/404 is the caller's
   * signal to treat this match as "no detail available," same as every
   * other free-tier gap this client surfaces rather than papering over.
   */
  async getMatchGoals(fdId: number): Promise<RawMatchGoal[]> {
    const data = await this.get<{ goals?: FdGoal[] }>(`/matches/${fdId}`);
    return (data.goals ?? []).map((g) => ({
      minute: g.minute ?? null,
      scorerName: g.scorer?.name ?? 'Unknown',
      assistName: g.assist?.name ?? null,
      type: g.type ?? null,
      teamFdId: g.team?.id ?? null,
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
interface FdMatchWithCompetition extends FdMatch {
  competition?: { code?: string };
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
interface FdGoal {
  minute?: number | null;
  type?: string | null;
  team?: { id: number } | null;
  scorer?: { id: number; name: string } | null;
  assist?: { id: number; name: string } | null;
}
