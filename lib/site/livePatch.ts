import type { FixtureWithTeams } from '@/lib/site/rows';

/**
 * Merges what `/api/live` currently reports into what the page is showing:
 *  - fixtures already on the page are updated in place, keeping their exact
 *    object identity when nothing has actually changed (status/score) — that
 *    identity is load-bearing: it's what lets React skip re-rendering those
 *    rows, which is what keeps scroll position and open filters intact when
 *    a goal lands elsewhere on the page;
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
): FixtureWithTeams[] {
  const currentById = new Map(current.map((f) => [f.id, f]));

  const merged = incoming.map((next) => {
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
