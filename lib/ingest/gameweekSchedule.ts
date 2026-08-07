import type { FplEvent } from '@/lib/providers/fpl';

/**
 * Which gameweeks a fantasy ingest run should fetch.
 *
 * Pulled out of `scripts/ingest/fantasy.ts` and made pure because this is
 * the only part of that job with a decision in it, and getting it wrong is
 * expensive in both directions: fetch too little and a gameweek's points
 * freeze half-scored forever; fetch everything every run and a job that
 * should make one request makes thirty-eight.
 *
 * The rule, in one sentence: **fetch any gameweek that has started and is
 * not already stored as settled.**
 *
 * That covers the three cases that actually happen —
 *
 *   - the gameweek in progress, whose points move all weekend;
 *   - the gameweek that just ended but has not been `data_checked`, where
 *     bonus points and corrections are still landing;
 *   - any earlier gameweek we never finished storing, because a run failed
 *     or the schedule was paused. This is the case a "just fetch the current
 *     one" rule silently loses, and nothing else would ever repair it.
 *
 * — and skips the two that do not:
 *
 *   - gameweeks that have not kicked off (nothing to score);
 *   - gameweeks FPL has marked settled *and* we have stored as settled,
 *     which by the end of a season is nearly all of them.
 */

export interface GameweekState {
  gameweek: number;
  /** What `fantasy_gameweek_points.is_final` holds for rows we already have. */
  isFinal: boolean;
}

export interface GameweekPlan {
  /** Gameweeks to fetch, in ascending order. */
  fetch: number[];
  /** Started, unsettled, but cut by `limit` — fetched by a later run. */
  deferred: number[];
  /** Human-readable account of the decision, for the run's log line. */
  reason: string;
}

/**
 * A cold start on a season already underway would otherwise fire one request
 * per gameweek in a single run. FPL's API is unmetered, but a job that can
 * make thirty-eight sequential requests is a job that can time out halfway
 * and leave no record of how far it got. Six per run catches up a month of
 * missed gameweeks in a day of normal runs, and the deferred list says
 * plainly what is still outstanding.
 */
export const DEFAULT_GAMEWEEK_LIMIT = 6;

export function planGameweekIngest(
  events: readonly FplEvent[],
  stored: readonly GameweekState[],
  opts: { now?: Date; limit?: number } = {},
): GameweekPlan {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_GAMEWEEK_LIMIT;
  const finalLocally = new Set(stored.filter((s) => s.isFinal).map((s) => s.gameweek));

  const started = events.filter((e) => hasStarted(e, now));
  const candidates = started
    // Settled upstream *and* stored settled here — there is nothing left to
    // learn about this gameweek. Either half alone is not enough: settled
    // upstream but unstored is precisely the gap this job repairs, and
    // stored-final while upstream still says otherwise would mean we
    // recorded a provisional week as settled, so re-fetching is right.
    .filter((e) => !(e.dataChecked && finalLocally.has(e.id)))
    .map((e) => e.id)
    .sort((a, b) => a - b);

  const fetch = candidates.slice(0, limit);
  const deferred = candidates.slice(limit);

  const reason =
    candidates.length === 0
      ? started.length === 0
        ? 'no gameweek has started yet'
        : `all ${started.length} started gameweeks are settled`
      : `${candidates.length} started and unsettled` +
        (deferred.length > 0 ? `, ${fetch.length} this run (limit ${limit})` : '');

  return { fetch, deferred, reason };
}

/**
 * Has this gameweek kicked off?
 *
 * The deadline is an hour or two before the first match, so a gameweek past
 * its deadline may have no minutes played yet — fetching it then returns a
 * page of zeroes, which is *correct*: they are published zeroes for a week
 * in progress, and `lib/fantasy/scoring.ts` reads a published zero as a real
 * blank rather than as missing data. That is fine for a week nobody has
 * played in yet, and it means the very first fetch of a live gameweek
 * happens as early as possible rather than after the first whistle.
 *
 * `finished`, `isCurrent` and `dataChecked` are each independently
 * sufficient — a gameweek cannot be any of those without having started —
 * and they cover the case of a missing or unparseable deadline, where
 * guessing from the clock would be worse than reading a flag FPL set.
 */
function hasStarted(event: FplEvent, now: Date): boolean {
  if (event.finished || event.isCurrent || event.dataChecked) return true;
  if (event.isNext) return false;
  if (event.deadlineTime === null) return false;
  const deadline = Date.parse(event.deadlineTime);
  return Number.isNaN(deadline) ? false : deadline <= now.getTime();
}
