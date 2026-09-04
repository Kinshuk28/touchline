import 'dotenv/config';
import { loadIngestEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { serviceClient } from '@/lib/db/client';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { replaceFixtureGoals, type FixtureGoalRow } from '@/lib/db/repositories/fixtureGoals';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

// Best-effort "who scored" detail for recently finished matches — see
// supabase/migrations/0014_fixture_goals.sql for why this is a separate,
// gracefully-degrading table rather than a guaranteed feature.

// Bounded per run: this shares the 10 req/min free-tier budget with
// core/live/squads/continental (see ingest-core.yml's concurrency-group
// comment), and a single busy matchday can have dozens of finished matches
// at once. Fetching only this many per run spreads the cost across several
// runs instead of spending the whole shared budget here.
const MAX_PER_RUN = 8;
// Generous on purpose — this job started running well into the season, so
// its first weeks of runs have a real backlog of already-finished matches
// to work through, not just the day's newest results. A tight window (48h)
// looked right for "keep up going forward" but meant every match that
// finished before this job existed could never become a candidate at all,
// no matter how many times the job ran — confirmed live: a fixture from
// eight days earlier had no goal rows and never would have got any.
// 4800h (200 days) comfortably spans a full season; MAX_PER_RUN above is
// what actually protects the shared API budget, not this window — widening
// it only grows the (free) candidate query, never the request count.
const LOOKBACK_HOURS = 4800;

// A placeholder scorer name, never a real one, written when a fixture has
// been checked and either genuinely has no goals to list (a real 0-0) or
// the provider didn't have detail for it (403/404). Without this, a
// fixture that legitimately has zero rows in `fixture_goals` — a scoreless
// draw, most obviously — would look identical to one never attempted at
// all, and get re-fetched forever. `lib/site/queries/fixtureGoals.ts`
// filters this placeholder out before it ever reaches a page.
const CHECKED_SENTINEL = '__checked_no_goals__';

function isSkippable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /football-data\.org (403|404) /.test(message);
}

const env = loadIngestEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('match-details');
let requests = 0;

try {
  const db = serviceClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();

  const { data: candidates, error: candErr } = await db
    .from('fixtures')
    .select('id, fd_id, home_goals, away_goals')
    .in('status', ['FINISHED', 'AWARDED'])
    .gte('kickoff_utc', since)
    .order('kickoff_utc', { ascending: false });
  if (candErr) throw new Error(`match-details: ${candErr.message}`);

  const rows = candidates ?? [];

  // A real 0-0 has nothing to fetch at all — skip it without spending a
  // request, rather than treating "checked, found none" the same as
  // "provider had none to give".
  const withGoals = rows.filter((f) => (f.home_goals ?? 0) + (f.away_goals ?? 0) > 0);
  const candidateIds = withGoals.map((f) => f.id);

  const { data: haveRows, error: haveErr } = candidateIds.length > 0
    ? await db.from('fixture_goals').select('fixture_id').in('fixture_id', candidateIds)
    : { data: [] as Array<{ fixture_id: number }>, error: null };
  if (haveErr) throw new Error(`match-details: ${haveErr.message}`);

  const alreadyChecked = new Set((haveRows ?? []).map((r) => r.fixture_id));
  const pending = withGoals.filter((f) => !alreadyChecked.has(f.id)).slice(0, MAX_PER_RUN);

  const teamIds = await getTeamIdMap();
  let fetched = 0;
  let unavailable = 0;

  for (const f of pending) {
    try {
      requests++;
      const goals = await fd.getMatchGoals(f.fd_id);
      const goalRows: FixtureGoalRow[] = goals.length > 0
        ? goals.map((g) => ({
          fixture_id: f.id,
          team_id: g.teamFdId !== null ? teamIds.get(g.teamFdId) ?? null : null,
          minute: g.minute,
          scorer_name: g.scorerName,
          assist_name: g.assistName,
          type: g.type,
          updated_at: now(),
        }))
        : [{
          fixture_id: f.id, team_id: null, minute: null,
          scorer_name: CHECKED_SENTINEL, assist_name: null, type: null, updated_at: now(),
        }];
      await replaceFixtureGoals(f.id, goalRows);
      fetched++;
    } catch (err) {
      if (!isSkippable(err)) throw err;
      unavailable++;
      await replaceFixtureGoals(f.id, [{
        fixture_id: f.id, team_id: null, minute: null,
        scorer_name: CHECKED_SENTINEL, assist_name: null, type: null, updated_at: now(),
      }]);
    }
  }

  const summary = `${pending.length} checked (${fetched} fetched, ${unavailable} unavailable), ${withGoals.length} candidates with goals, ${rows.length - withGoals.length} scoreless skipped`;
  await finishRun(runId, 'ok', summary, requests);
  console.log(`match-details done: ${summary}, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('match-details failed:', message);
  process.exit(1);
}
