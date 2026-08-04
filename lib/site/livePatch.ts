import type { FixtureWithTeams } from '@/lib/site/rows';

/**
 * Merges what `/api/live` currently reports into what the page is showing:
 *  - an optional `allowedLeagueIds` scopes `incoming` first, before anything
 *    else happens: a fixture outside it is dropped, never merged in. This is
 *    a defensive backstop, not the primary control — `/api/live` itself
 *    scopes its query by the same `leagues` codes the page asked for (see
 *    `app/api/live/route.ts`), but a response from a version-skewed server
 *    during a rolling deploy must not be able to silently widen the filter
 *    the user chose. `undefined` means "no filter," matching today's
 *    behaviour exactly.
 *  - fixtures already on the page are updated in place, keeping their exact
 *    object identity when nothing has actually changed (status/score). That
 *    identity is only load-bearing because of two other things working with
 *    it: `ScoreRow` is wrapped in `React.memo`, and `LiveScores` computes
 *    each row's `now`-derived display text in the parent and skips
 *    `setState` entirely when `hasLiveChanges` says nothing moved — so an
 *    unchanged fixture reaches `ScoreRow` with every prop `Object.is`-equal
 *    to last render, which is what actually lets React skip re-rendering
 *    that row, keeping scroll position and open filters intact when a goal
 *    lands elsewhere on the page;
 *  - fixtures the page has not seen yet (a match that kicked off after the
 *    page was server-rendered) are appended, not silently dropped;
 *  - fixtures the server no longer reports (aged out of the recent window,
 *    or postponed) are removed;
 *  - the result stays ordered by kickoff_utc ascending, matching the order
 *    the server already returns.
 *
 * `/api/live` deliberately returns full `FixtureWithTeams` rows rather than a
 * thin id/score patch: a fixture that is new to the page needs club names
 * and crests to render at all, which a bare score patch can't supply — see
 * `app/api/live/route.ts`.
 */
export function mergeLiveFixtures(
  current: FixtureWithTeams[],
  incoming: FixtureWithTeams[],
  allowedLeagueIds?: number[],
): FixtureWithTeams[] {
  const scoped = allowedLeagueIds === undefined
    ? incoming
    : incoming.filter((f) => allowedLeagueIds.includes(f.league_id));

  const currentById = new Map(current.map((f) => [f.id, f]));

  const merged = scoped.map((next) => {
    const prev = currentById.get(next.id);
    if (
      prev &&
      prev.status === next.status &&
      prev.home_goals === next.home_goals &&
      prev.away_goals === next.away_goals
    ) {
      return prev;
    }
    return next;
  });

  merged.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  return merged;
}

/**
 * True when `merged` (the output of `mergeLiveFixtures`) is reference-
 * identical to `prev`, element for element — i.e. a poll genuinely found
 * nothing to change. `LiveScores` uses this to skip `setFixtures`/`setStamp`
 * entirely on a no-op poll, so a poll that changes nothing causes zero
 * re-renders, rather than pushing a fresh `now` through every row every
 * `POLL_MS` regardless of whether anything moved.
 */
export function hasLiveChanges(prev: FixtureWithTeams[], merged: FixtureWithTeams[]): boolean {
  if (prev.length !== merged.length) return true;
  return !prev.every((f, i) => f === merged[i]);
}

export interface LiveApiResponse {
  now: string;
  fixtures: FixtureWithTeams[];
}

/**
 * Validates the shape of a `/api/live` response body before anything trusts
 * it. `fetch` + `res.json()` can return structurally malformed-but-valid
 * JSON — plausible during a rolling deploy with client/server version skew —
 * and `mergeLiveFixtures` calling `.map()`/`.filter()` on a non-array would
 * throw inside a `setState` updater, uncaught, crashing the panel. A bad
 * shape is treated exactly like a failed request: ignored, not thrown.
 */
export function parseLiveResponse(body: unknown): LiveApiResponse | null {
  if (typeof body !== 'object' || body === null) return null;
  const { now, fixtures } = body as Record<string, unknown>;
  if (typeof now !== 'string' || !Array.isArray(fixtures)) return null;
  return { now, fixtures: fixtures as FixtureWithTeams[] };
}
