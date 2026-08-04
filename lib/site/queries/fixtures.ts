import { readClient } from '@/lib/site/supabase';
import type { FixtureWithTeams } from '@/lib/site/rows';

// IN_PLAY/PAUSED are always shown, regardless of kickoff time — being in play is the
// strongest possible signal a match is happening right now.
export const LIVE_STATUSES = ['IN_PLAY', 'PAUSED'] as const;

// FINISHED/AWARDED are shown only if kickoff falls inside the recent window below.
// AWARDED (a match awarded to a team, e.g. after a forfeit) is a terminal result just
// like FINISHED, so it gets the same recency treatment rather than being shown forever.
export const RECENT_FINISHED_STATUSES = ['FINISHED', 'AWARDED'] as const;

// POSTPONED, CANCELLED and SUSPENDED are never shown by getLiveAndRecent, no matter what
// their kickoff time is — they are deliberately absent from both status sets above, so
// falling through to `isLiveOrRecent`'s final `return false` excludes them.
//
// This is the opposite rule from lib/ingest/matchWindow.ts's isMatchWindowOpen/isLiveRelevant,
// which deliberately treat SUSPENDED as still relevant so the live job keeps polling a match
// that might resume. The two rules look contradictory side by side, but they answer different
// questions: matchWindow.ts asks "should we still fetch this fixture's data", this file asks
// "should we display this as a live score right now". A suspended match is not a live score —
// polling it is correct, showing it in the "Live & recent" panel is not.
export const RECENT_WINDOW_HOURS = 6;

const TEAM_FIELDS = 'id,slug,name,short_name,tla,crest_url';

/** One select, both teams joined — a crest must never cost a second query. */
export function buildFixtureSelect(): string {
  return [
    'id', 'league_id', 'season', 'kickoff_utc', 'status', 'matchday',
    'home_goals', 'away_goals', 'updated_at',
    `home:home_team_id(${TEAM_FIELDS})`,
    `away:away_team_id(${TEAM_FIELDS})`,
  ].join(',');
}

function hoursAgo(now: Date, h: number): string {
  return new Date(now.getTime() - h * 3600_000).toISOString();
}

/**
 * The decision rule behind getLiveAndRecent, extracted as a pure function so it can be
 * unit-tested without a database. The query below is built from the exact same two
 * status sets, so this function and the query can never drift apart in what they select.
 */
export function isLiveOrRecent(status: string, kickoffUtc: string, now: Date): boolean {
  if ((LIVE_STATUSES as readonly string[]).includes(status)) return true;

  if ((RECENT_FINISHED_STATUSES as readonly string[]).includes(status)) {
    const kickoffTime = new Date(kickoffUtc).getTime();
    const nowTime = now.getTime();
    return kickoffTime >= nowTime - RECENT_WINDOW_HOURS * 3600_000 && kickoffTime <= nowTime;
  }

  // SCHEDULED, TIMED, POSTPONED, CANCELLED, SUSPENDED: never live/recent for display.
  return false;
}

/**
 * Anything in play, plus anything that finished recently enough to still matter.
 *
 * `leagueIds`, when given, scopes both branches to those leagues — `undefined` means
 * every league (today's behaviour, unchanged). An explicit empty array means every
 * requested league code was unrecognised: that must match nothing, not silently widen
 * back to everything, so it short-circuits before any query runs. See
 * `lib/site/leagueFilter.ts#resolveLeagueIds` for how callers arrive at that empty array.
 */
export async function getLiveAndRecent(now: Date, leagueIds?: number[]): Promise<FixtureWithTeams[]> {
  if (leagueIds && leagueIds.length === 0) return [];

  // Two queries merged in JS rather than one `.or()` string: PostgREST's `.or()` syntax
  // for "status in (A,B) OR (status in (C,D) AND kickoff_utc between X and Y)" needs a
  // hand-built nested and()/in() filter string that's easy to get subtly wrong and can't
  // be typo-checked by TypeScript. Two plain, independently-readable queries plus a trivial
  // JS merge+sort is clearer and just as correct for a two-branch OR like this one.
  let liveQuery = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .in('status', LIVE_STATUSES);
  let recentQuery = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .in('status', RECENT_FINISHED_STATUSES)
    .gte('kickoff_utc', hoursAgo(now, RECENT_WINDOW_HOURS))
    .lte('kickoff_utc', now.toISOString());

  if (leagueIds && leagueIds.length > 0) {
    liveQuery = liveQuery.in('league_id', leagueIds);
    recentQuery = recentQuery.in('league_id', leagueIds);
  }

  const [live, recentFinished] = await Promise.all([liveQuery, recentQuery]);
  if (live.error) throw new Error(`getLiveAndRecent: ${live.error.message}`);
  if (recentFinished.error) throw new Error(`getLiveAndRecent: ${recentFinished.error.message}`);

  const merged = [...(live.data ?? []), ...(recentFinished.data ?? [])] as unknown as FixtureWithTeams[];
  merged.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  return merged;
}

export async function getUpcoming(now: Date, limit = 12): Promise<FixtureWithTeams[]> {
  const { data, error } = await readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gt('kickoff_utc', now.toISOString())
    .in('status', ['SCHEDULED', 'TIMED'])
    .order('kickoff_utc', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getUpcoming: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}

/**
 * `leagueIds`, when given, scopes the range to those leagues — `undefined`
 * means every league. An explicit empty array means every requested league
 * code was unrecognised: that must match nothing, not silently widen back
 * to everything, so it short-circuits before any query runs. Same rule as
 * `getLiveAndRecent` above, kept consistent so `/calendar` and its `.ics`
 * export agree with `/scores` about what an unknown league code means.
 */
export async function getFixturesInRange(
  fromIso: string,
  toIso: string,
  leagueIds?: number[],
): Promise<FixtureWithTeams[]> {
  if (leagueIds && leagueIds.length === 0) return [];

  let q = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gte('kickoff_utc', fromIso)
    .lte('kickoff_utc', toIso)
    .order('kickoff_utc', { ascending: true });
  if (leagueIds && leagueIds.length > 0) q = q.in('league_id', leagueIds);
  const { data, error } = await q;
  if (error) throw new Error(`getFixturesInRange: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}
