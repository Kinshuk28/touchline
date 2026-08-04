import 'dotenv/config';
import { loadIngestEnv } from '@/lib/config/env';
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

// Matches across all five leagues in one request instead of one full-season
// request per league (see FootballDataClient.getMatchesAcrossLeagues). A
// generous ±1 day window comfortably covers anything `isLiveRelevant` would
// ever care about (in-play, or finished within the last 150 minutes) while
// staying far under the provider's 10-day cap on the date span.
const WINDOW_DAYS = 1;

const env = loadIngestEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const nowIso = () => new Date().toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
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
  const codes = LEAGUE_SEEDS.map((s) => s.code);

  const now = new Date();
  const dateFrom = dateOnly(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));
  const dateTo = dateOnly(new Date(now.getTime() + WINDOW_DAYS * 86_400_000));

  for (let poll = 0; poll < POLLS; poll++) {
    requests++;
    const matches = await fd.getMatchesAcrossLeagues(codes, dateFrom, dateTo, CURRENT_SEASON);
    const active = matches.filter((m) => isLiveRelevant(m, now));
    if (active.length > 0) {
      await upsertFixtures(active.map((m) => {
        const leagueId = leagueIds.get(m.leagueCode);
        if (leagueId === undefined) throw new Error(`league ${m.leagueCode} missing — run backfill first`);
        return {
          fd_id: m.fdId, league_id: leagueId,
          home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
          away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
          season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
          matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
          half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
          last_updated: m.lastUpdated, updated_at: nowIso(),
        };
      }));
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
