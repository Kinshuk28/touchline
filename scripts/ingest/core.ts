import 'dotenv/config';
import { loadIngestEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { getPlayerIdByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { createMissingScorerPlayers } from '@/lib/ingest/scorerPlayers';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const env = loadIngestEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('core');
let requests = 0;

try {
  const leagueIds = await getLeagueIdMap();
  const teamIds = await getTeamIdMap();
  let playerIds = await getPlayerIdByFdId();

  for (const s of LEAGUE_SEEDS) {
    const leagueId = leagueIds.get(s.code);
    if (leagueId === undefined) throw new Error(`league ${s.code} missing — run backfill first`);

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

    requests++;
    const table = await fd.getStandings(s.code, CURRENT_SEASON);
    // Resolve team_id explicitly and drop (with a loud warning) any row whose
    // club has no `teams` row yet, rather than the old `teamIds.get(...)!`
    // + `.filter(team_id !== undefined)` combo — that `!` lied to the type
    // checker (the map already produces `team_id: number | undefined` in
    // practice) and made the filter look like unreachable dead code, so a
    // missing club silently rendered a short table with status 'ok' and
    // nothing in the logs. See scripts/backfill.ts phase 7 for the identical
    // pattern this now matches.
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

    // Top scorers are the ONLY free source of goals/assists outside the
    // Premier League. Without this, four of the five leagues have players
    // with no statistics at all. Fields FPL provides and this does not
    // (minutes, xG) are written as null, never as zero.
    requests++;
    const scorers = await fd.getScorers(s.code, CURRENT_SEASON);

    // La Liga and Serie A get an empty squad array from getSquad for every
    // club, so this scorers list is the ONLY source of players those two
    // leagues have at all. Create a player row for any scorer not already
    // in the id map (from bio fields on the payload itself, null where
    // absent — never invented) before resolving ids for the stats write
    // below, or those scorers' stats would silently resolve to nothing.
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

    console.log(`${s.code}: ${matches.length} fixtures, ${table.length} table rows, ${scorers.length} scorers, ${newPlayers} players created`);
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`core done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('core failed:', message);
  process.exit(1);
}
