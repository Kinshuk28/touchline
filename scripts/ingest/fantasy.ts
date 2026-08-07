import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { getPlayerIdByFplId } from '@/lib/db/repositories/players';
import {
  upsertGameweekPoints,
  getStoredGameweekState,
  upsertFantasyPool,
  upsertFantasyGameweeks,
} from '@/lib/db/repositories/fantasyPoints';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { planGameweekIngest } from '@/lib/ingest/gameweekSchedule';
import type { FantasyGameweekPointsRow } from '@/lib/db/repositories/fantasyPoints';

/**
 * Per-gameweek player scoring — the one thing this database never held, and
 * the thing a fantasy game cannot be built without.
 *
 * `player_season_stats` holds season aggregates from both providers, and the
 * Phase C spec explains at length why differencing those into weekly points
 * is not an option: an ingest gap becomes a zero-point week and an upstream
 * correction becomes a negative one. So this job reads FPL's
 * `event/{id}/live` — one request returning every player's stat line for one
 * gameweek — and stores it as published.
 *
 * WHAT IT DOES NOT DO. It does not compute points. `points` is FPL's own
 * `total_points`. Their rules change between seasons and a reimplementation
 * here would be a second source of truth drifting silently from the first.
 * The rules *this* game defines — who counts, who doubles, what happens to a
 * pick who did not play — live in `lib/fantasy/scoring.ts`, over these
 * stored numbers.
 *
 * WHICH GAMEWEEKS. Decided by `planGameweekIngest`, which is pure and
 * tested: every gameweek that has started and is not already stored settled.
 * That deliberately includes weeks an earlier failed run left half-written,
 * which a "fetch the current one" rule would lose forever.
 *
 * IT ALSO REFRESHES THE PICKABLE POOL. The same `bootstrap-static` response
 * carries every player's `now_cost` and `element_type`, which are what the
 * picker needs and what nothing else in this database records. Prices move
 * all season, so `fantasy_player_season` is overwritten on every run — and
 * on every run, including ones with no gameweek to fetch, because the picker
 * is used between gameweeks more than during them.
 *
 * REQUEST COST. One `bootstrap-static` for the calendar, the pool and the
 * identity map, plus one per gameweek fetched — normally 2, at most 7. FPL's
 * API is unmetered and needs no key; the count is still reported on the run
 * because an unbounded number of requests is a bug whether or not anyone
 * bills for them.
 *
 * IDENTITY. Rows are keyed on our `players.id`, resolved through `fpl_id` by
 * the players job (`scripts/ingest/players.ts`), which does the real work of
 * reconciling FPL's elements with football-data's squads. A stat line whose
 * `fpl_id` this database has never seen is skipped and counted, never
 * inserted as a new player — that reconciliation belongs in one place, and
 * this is not it.
 */

const runId = await startRun('fantasy');
let requests = 0;

try {
  const fpl = new FplClient();

  const { events, players } = await fpl.getBootstrap();
  requests += 1;
  if (events.length === 0) throw new Error('FPL bootstrap-static returned no gameweek calendar');

  // The pickable pool, refreshed from the same request that fetched the
  // calendar. Prices move all season as managers buy and sell, so this is a
  // full overwrite rather than an insert-once — and it has to happen even on
  // a run that fetches no gameweeks, which is why it sits above the early
  // exit below.
  const idByFplForPool = await getPlayerIdByFplId();
  let poolSkipped = 0;
  const pool = players.flatMap((p) => {
    const playerId = idByFplForPool.get(p.fplId);
    // A player with no price or no position is not pickable, and a guessed
    // one would be free to buy or count toward the wrong shape. Skipped, not
    // defaulted.
    if (playerId === undefined || p.nowCost === null || p.positionCode === null) {
      poolSkipped += 1;
      return [];
    }
    return [{
      player_id: playerId,
      season: CURRENT_SEASON,
      position: p.positionCode,
      price_tenths: p.nowCost,
      updated_at: new Date().toISOString(),
    }];
  });
  await upsertFantasyPool(pool);
  console.log(`fantasy: pool ${pool.length} players priced${poolSkipped > 0 ? `, ${poolSkipped} skipped` : ''}`);

  // The calendar itself, so the picker can name a gameweek and show its
  // deadline without inferring a schedule from which points rows happen to
  // exist.
  await upsertFantasyGameweeks(events.map((e) => ({
    season: CURRENT_SEASON,
    gameweek: e.id,
    name: e.name,
    deadline_utc: e.deadlineTime,
    finished: e.finished,
    is_final: e.dataChecked,
    is_current: e.isCurrent,
    updated_at: new Date().toISOString(),
  })));

  const stored = await getStoredGameweekState(CURRENT_SEASON);
  const plan = planGameweekIngest(events, stored, { now: new Date() });
  console.log(`fantasy: ${plan.reason}`);

  if (plan.fetch.length === 0) {
    const message = `${events.length} gameweeks, pool ${pool.length} priced; nothing to fetch — ${plan.reason}`;
    await finishRun(runId, 'ok', message, requests);
    console.log(`fantasy done: ${message}`);
    process.exit(0);
  }

  // Reused across gameweeks — the map is the same for all of them, and the
  // pool refresh above already paid for reading it.
  const idByFpl = idByFplForPool;
  const checkedById = new Map(events.map((e) => [e.id, e.dataChecked]));
  const now = new Date().toISOString();

  let written = 0;
  let unknown = 0;
  const perGameweek: string[] = [];

  for (const gameweek of plan.fetch) {
    const lines = await fpl.getGameweekLive(gameweek);
    requests += 1;

    // `is_final` comes from the calendar's `data_checked`, not from anything
    // in the stat lines themselves — a settled gameweek and a gameweek whose
    // numbers happen to have stopped moving are not the same claim, and only
    // FPL can make the first one.
    const isFinal = checkedById.get(gameweek) === true;

    const rows: FantasyGameweekPointsRow[] = [];
    for (const line of lines) {
      const playerId = idByFpl.get(line.fplId);
      if (playerId === undefined) {
        unknown += 1;
        continue;
      }
      rows.push({
        player_id: playerId,
        season: CURRENT_SEASON,
        gameweek,
        // Every field below is `null` when FPL published nothing for it,
        // never a substituted zero. A published zero arrives as 0 and stays
        // 0; the distinction is load-bearing in lib/fantasy/scoring.ts,
        // where an unpublished score is pending rather than a blank week.
        points: line.totalPoints,
        minutes: line.minutes,
        goals: line.goals,
        assists: line.assists,
        clean_sheets: line.cleanSheets,
        goals_conceded: line.goalsConceded,
        own_goals: line.ownGoals,
        penalties_saved: line.penaltiesSaved,
        penalties_missed: line.penaltiesMissed,
        yellow_cards: line.yellowCards,
        red_cards: line.redCards,
        saves: line.saves,
        bonus: line.bonus,
        is_final: isFinal,
        updated_at: now,
      });
    }

    await upsertGameweekPoints(rows);
    written += rows.length;
    perGameweek.push(`GW${gameweek} ${rows.length}${isFinal ? ' final' : ''}`);
    console.log(`fantasy: GW${gameweek} — ${lines.length} lines, ${rows.length} stored${isFinal ? ', final' : ''}`);
  }

  if (unknown > 0) {
    // Expected in small numbers: a player FPL added since the last players
    // job ran. Persistently large means the two jobs have drifted apart and
    // the fantasy game is scoring an incomplete league.
    console.warn(`fantasy: ${unknown} stat lines had no known player — run scripts/ingest/players.ts`);
  }
  if (plan.deferred.length > 0) {
    console.log(`fantasy: deferred to a later run: ${plan.deferred.map((g) => `GW${g}`).join(', ')}`);
  }

  const message =
    `${events.length} gameweeks, pool ${pool.length} priced; ${written} rows across ${plan.fetch.length} gameweeks (${perGameweek.join(', ')})` +
    (unknown > 0 ? `, ${unknown} unknown players` : '') +
    (plan.deferred.length > 0 ? `, ${plan.deferred.length} deferred` : '');
  await finishRun(runId, 'ok', message, requests);
  console.log(`fantasy done: ${message}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('fantasy failed:', message);
  process.exit(1);
}
