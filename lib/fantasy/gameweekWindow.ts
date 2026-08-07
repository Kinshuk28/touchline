/**
 * Which gameweek a squad change takes effect from.
 *
 * The rule every fantasy game runs on: **you cannot change a side once its
 * matches have started.** Without it, a manager could watch a goal go in and
 * then buy the scorer, and every score in the game would be worthless.
 *
 * So a save never edits the current gameweek once its deadline has passed —
 * it becomes a new generation of picks that starts at the next one
 * (`fantasy_pick.active_from_gameweek`, see supabase/migrations/0008). Before
 * the deadline, a save replaces the pending generation, because nothing has
 * been played yet and there is nothing to protect.
 *
 * Pure and separately tested because the alternative is a rule that lives
 * inside a save handler and is only exercised on the one weekend a season
 * when it matters.
 */

export interface GameweekWindow {
  gameweek: number;
  /** Null when FPL published no deadline. Treated as "already closed" — see `openGameweek`. */
  deadlineUtc: string | null;
  finished: boolean;
}

/**
 * The earliest gameweek a save may still affect.
 *
 * The first gameweek whose deadline has not passed and which is not already
 * finished. `null` when the season is over — there is nothing left to pick
 * for, and the caller says so rather than writing picks into a gameweek that
 * will never be played.
 *
 * A gameweek with no published deadline is skipped rather than treated as
 * open. Guessing "still open" on missing data is the direction that lets
 * someone edit a side mid-match; guessing "closed" only ever costs them a
 * week they can pick again for next time.
 */
export function openGameweek(calendar: readonly GameweekWindow[], now: Date = new Date()): number | null {
  const upcoming = [...calendar]
    .sort((a, b) => a.gameweek - b.gameweek)
    .find((gw) => !gw.finished && gw.deadlineUtc !== null && isFuture(gw.deadlineUtc, now));
  return upcoming?.gameweek ?? null;
}

/**
 * How long is left, as a sentence — or null when there is no deadline to
 * report. Rounded down, and never below "under a minute", because a picker
 * counting individual seconds toward a deadline is a picker telling people
 * to cut it fine.
 */
export function timeUntilDeadline(deadlineUtc: string | null, now: Date = new Date()): string | null {
  if (deadlineUtc === null) return null;
  const ms = Date.parse(deadlineUtc) - now.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'closed';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;

  return `${Math.floor(hours / 24)} days`;
}

function isFuture(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > now.getTime();
}
