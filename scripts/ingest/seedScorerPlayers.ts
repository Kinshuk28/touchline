import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, PREVIOUS_SEASON } from '@/lib/ingest/leagueSeed';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { getPlayerIdByFdId } from '@/lib/db/repositories/players';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { createMissingScorerPlayers } from '@/lib/ingest/scorerPlayers';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

/**
 * One-off follow-up to the Task 9 backfill, run as a dedicated script rather
 * than as an added phase inside `scripts/backfill.ts`.
 *
 * Why dedicated, not a backfill phase: `backfill.ts` already ran successfully
 * (Task 9) and its 7 phases are each individually expensive — re-running the
 * whole script to add one missing step would re-fetch ~116 requests' worth of
 * leagues/teams/squads/fixtures/standings that are already correct in the
 * database, for the sole purpose of reaching a phase that didn't exist yet.
 * A small standalone script scoped to exactly the gap (season 2025 scorers →
 * missing players → stats) does the same job in 5 requests total and leaves
 * every already-correct phase of the original backfill untouched.
 *
 * Why season 2025 specifically: season 2026 has 0 scorers everywhere (no
 * matches played yet, confirmed in Task 10's first `core.ts` run), so running
 * this same path for the current season creates nothing. Season 2025 is the
 * concluded season with real goals/assists — using it means La Liga and
 * Serie A get real players and real stats immediately, rather than the site
 * waiting for the new season to slowly populate scorers over its first few
 * matchdays.
 *
 * This uses the exact same `createMissingScorerPlayers` helper `core.ts`
 * uses for the current season, so both paths create players identically:
 * `fd_id`/name/position/nationality/date_of_birth from the scorers payload,
 * `team_id` resolved via the team-id map, `slug` as
 * `${slugify(name)}-${fdId}`, `photo_url` always null.
 */
const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('seed-scorer-players-2025');
let requests = 0;

try {
  const leagueIds = await getLeagueIdMap();
  const teamIds = await getTeamIdMap();
  let playerIds = await getPlayerIdByFdId();

  for (const s of LEAGUE_SEEDS) {
    const leagueId = leagueIds.get(s.code);
    if (leagueId === undefined) throw new Error(`league ${s.code} missing — run backfill first`);

    requests++;
    const scorers = await fd.getScorers(s.code, PREVIOUS_SEASON);

    const newPlayers = await createMissingScorerPlayers(scorers, teamIds, playerIds);
    if (newPlayers > 0) playerIds = await getPlayerIdByFdId();

    await upsertPlayerSeasonStats(scorers.flatMap((sc) => {
      const playerId = playerIds.get(sc.playerFdId);
      if (playerId === undefined) return [];
      return [{
        player_id: playerId, league_id: leagueId, season: PREVIOUS_SEASON,
        source: 'football-data' as const,
        appearances: sc.playedMatches, minutes: null,
        goals: sc.goals, assists: sc.assists, expected_goals: null,
        yellow_cards: null, red_cards: null, updated_at: now(),
      }];
    }));

    console.log(`${s.code}: ${scorers.length} scorers, ${newPlayers} players created`);
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`seed-scorer-players-2025 done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('seed-scorer-players-2025 failed:', message);
  process.exit(1);
}
