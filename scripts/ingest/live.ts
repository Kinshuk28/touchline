import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { isMatchWindowOpen, isLiveRelevant } from '@/lib/ingest/matchWindow';
import { LEAGUE_SEEDS, CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertFixtures, getWindowFixtures } from '@/lib/db/repositories/fixtures';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const POLLS = 4;
const GAP_MS = 60_000;

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runId = await startRun('live');
let requests = 0;

try {
  const window = await getWindowFixtures();
  if (!isMatchWindowOpen(window, new Date())) {
    await finishRun(runId, 'ok', 'no match window open, skipped', 0);
    console.log('live: no match window open, skipped');
    process.exit(0);
  }

  const leagueIds = await getLeagueIdMap();
  const teamIds = await getTeamIdMap();

  const now = new Date();
  for (let poll = 0; poll < POLLS; poll++) {
    for (const s of LEAGUE_SEEDS) {
      const matches = await fd.getMatches(s.code, CURRENT_SEASON); requests++;
      const active = matches.filter((m) => isLiveRelevant(m, now));
      if (active.length === 0) continue;
      await upsertFixtures(active.map((m) => ({
        fd_id: m.fdId, league_id: leagueIds.get(s.code)!,
        home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
        away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
        season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
        matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
        half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
        last_updated: m.lastUpdated, updated_at: nowIso(),
      })));
    }
    if (poll < POLLS - 1) await sleep(GAP_MS);
  }

  await finishRun(runId, 'ok', `${POLLS} polls`, requests);
  console.log(`live done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('live failed:', message);
  process.exit(1);
}
