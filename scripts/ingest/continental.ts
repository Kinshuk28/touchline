import 'dotenv/config';
import { loadIngestEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { CONTINENTAL_SEEDS, CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { slugWithFdId } from '@/lib/db/slug';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap, type TeamRow } from '@/lib/db/repositories/teams';
import { upsertLeagueTeams } from '@/lib/db/repositories/leagueTeams';
import { getPlayerIdByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { createMissingScorerPlayers } from '@/lib/ingest/scorerPlayers';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

// Continental competitions (Champions League today) run through their own
// ingest path, separate from scripts/ingest/core.ts and
// scripts/ingest/squads.ts, because a club in one of these also belongs to
// one of the five tracked domestic leagues at the same time. Writing that
// to `teams.league_id` — the column core/squads treat as "this club's one
// domestic league" — would make whichever ingest job runs last silently
// evict the other from that column. See
// supabase/migrations/0013_league_teams.sql for the full reasoning; this
// script only ever writes continental membership to `league_teams`, never
// to `teams.league_id`.

function is403(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /football-data\.org 403 /.test(message);
}

const env = loadIngestEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('continental');
let requests = 0;

try {
  // Phase 1: seed the leagues row(s) — same idempotent upsert
  // scripts/backfill.ts phase 1 uses for the five domestic leagues.
  await upsertLeagues(CONTINENTAL_SEEDS.map((s) => ({
    fd_code: s.code, fd_id: s.fdId, slug: s.slug, name: s.name, country: s.country,
    emblem_url: `https://crests.football-data.org/${s.code}.png`,
    current_season: CURRENT_SEASON, season_start: null, season_end: null,
  })));
  const leagueIds = await getLeagueIdMap();

  let teamIds = await getTeamIdMap();
  let playerIds = await getPlayerIdByFdId();

  for (const s of CONTINENTAL_SEEDS) {
    const leagueId = leagueIds.get(s.code);
    if (leagueId === undefined) throw new Error(`league ${s.code} missing after seeding`);

    // Phase 2: this competition's current clubs. Most are already in
    // `teams` from their domestic league's own ingest (Real Madrid, Man
    // City, ...) — those are left completely untouched here, including
    // their `league_id`. A club with no `teams` row at all (e.g. from a
    // domestic league this project doesn't track, like a Portuguese or
    // Dutch side) is inserted fresh with `league_id: null` — the same
    // convention scripts/backfill.ts phase 3 uses for a club with no
    // current domestic-league home, since this project has no domestic
    // league of its own to attribute it to.
    requests++;
    const teams = await fd.getCompetitionTeams(s.code);
    const newTeams: TeamRow[] = [];
    for (const team of teams) {
      if (teamIds.has(team.fdId)) continue;
      newTeams.push({
        fd_id: team.fdId, league_id: null, slug: slugWithFdId(team.name, team.fdId), name: team.name,
        short_name: team.shortName, tla: team.tla, crest_url: team.crestUrl,
        venue: team.venue, founded: team.founded, club_colors: team.clubColors,
      });
    }
    if (newTeams.length > 0) {
      await upsertTeams(newTeams);
      teamIds = await getTeamIdMap();
    }

    const membership = teams
      .map((team) => teamIds.get(team.fdId))
      .filter((id): id is number => id !== undefined)
      .map((teamId) => ({ league_id: leagueId, team_id: teamId, season: CURRENT_SEASON, updated_at: now() }));
    await upsertLeagueTeams(membership);
    console.log(`${s.code}: ${teams.length} clubs (${newTeams.length} new), ${membership.length} membership rows`);

    // Phase 3: fixtures. Same shape as scripts/ingest/core.ts — fixtures
    // already carry their own `league_id` per row, independent of
    // `teams.league_id`, so no special handling is needed here.
    requests++;
    const matches = await fd.getMatches(s.code, CURRENT_SEASON);
    await upsertFixtures(matches.map((m) => ({
      fd_id: m.fdId, league_id: leagueId,
      home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
      away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
      season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
      matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
      half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
      last_updated: m.lastUpdated, updated_at: now(),
    })));
    console.log(`${s.code}: ${matches.length} fixtures`);

    // Phase 4: standings — only meaningful during the league phase (UEFA's
    // single 36-team table, since the 2024-25 reshape); the provider
    // returns an empty or absent table before it starts and during the
    // knockout rounds after it ends, which upsertStandings simply writes as
    // zero rows, not an error. A 403 here (some free-tier keys may not
    // carry standings access for this competition even though matches/teams
    // are granted) must not abort fixtures/scorers below — same
    // don't-abort-on-403 rule scripts/backfill.ts phase 5 and
    // scripts/ingest/squads.ts already apply per-club, applied here per
    // data type instead.
    try {
      requests++;
      const table = await fd.getStandings(s.code, CURRENT_SEASON);
      const standingsRows = [];
      for (const r of table) {
        const teamId = teamIds.get(r.teamFdId);
        if (teamId === undefined) {
          console.warn(`     WARNING: unresolved club "${r.teamName}" (fd_id ${r.teamFdId}) in ${s.code} standings — row dropped`);
          continue;
        }
        standingsRows.push({
          league_id: leagueId, team_id: teamId, season: CURRENT_SEASON,
          position: r.position, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
          goals_for: r.goalsFor, goals_against: r.goalsAgainst,
          goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
        });
      }
      await upsertStandings(standingsRows);
      console.log(`${s.code}: ${standingsRows.length} standings rows`);
    } catch (err) {
      if (!is403(err)) throw err;
      console.warn(`${s.code}: standings not available on this plan (403) — skipped`);
    }

    // Phase 5: top scorers, same 403-tolerant treatment as standings.
    try {
      requests++;
      const scorers = await fd.getScorers(s.code, CURRENT_SEASON);
      const newPlayers = await createMissingScorerPlayers(scorers, teamIds, playerIds);
      if (newPlayers > 0) playerIds = await getPlayerIdByFdId();

      await upsertPlayerSeasonStats(scorers.flatMap((sc) => {
        const playerId = playerIds.get(sc.playerFdId);
        if (playerId === undefined) return [];
        return [{
          player_id: playerId, league_id: leagueId, season: CURRENT_SEASON,
          source: 'football-data' as const,
          appearances: sc.playedMatches, minutes: null,
          goals: sc.goals, assists: sc.assists, expected_goals: null,
          yellow_cards: null, red_cards: null, updated_at: now(),
        }];
      }));
      console.log(`${s.code}: ${scorers.length} scorers, ${newPlayers} players created`);
    } catch (err) {
      if (!is403(err)) throw err;
      console.warn(`${s.code}: scorers not available on this plan (403) — skipped`);
    }
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`continental done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('continental failed:', message);
  process.exit(1);
}
