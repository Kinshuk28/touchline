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

// Important 7: `getUpcoming` requires `kickoff_utc > now` and `getLiveAndRecent`
// (until this branch existed) required `IN_PLAY`/`PAUSED`. A fixture whose
// kickoff has just passed but whose status is still `SCHEDULED`/`TIMED` —
// the normal state for up to a few minutes given the ~5-minute ingest
// cadence — fell into neither list and vanished from `/scores` entirely
// until ingestion flipped its status. This grace window keeps it visible,
// honestly labelled "Kicked off" (see `scoreDisplay.ts#scoreCellText`)
// rather than shown as either a stale kickoff time or a live score it
// doesn't have yet. Deliberately short and separate from
// `RECENT_WINDOW_HOURS`: this fixture has not finished, it has (as far as
// we know) just started.
export const KICKOFF_GRACE_STATUSES = ['SCHEDULED', 'TIMED'] as const;
export const KICKOFF_GRACE_MINUTES = 30;

// fd_id added for the landing page's marquee-club fixture selection
// (lib/site/marqueeClubs.ts), which is keyed by football-data.org's team
// id rather than our internal one. club_colors and venue added for
// Direction Two piece 2 (docs/superpowers/specs/2026-08-04-touchline-direction-two.md):
// the fixture-row club-colour bar (lib/site/clubColors.ts) and the venue
// line both need real per-team data, not just identity/crest fields.
const TEAM_FIELDS = 'id,fd_id,slug,name,short_name,tla,crest_url,club_colors,venue';

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

function minutesAgo(now: Date, m: number): string {
  return new Date(now.getTime() - m * 60_000).toISOString();
}

/**
 * The decision rule behind getLiveAndRecent, extracted as a pure function so it can be
 * unit-tested without a database. The query below is built from the exact same three
 * status sets, so this function and the query can never drift apart in what they select.
 */
export function isLiveOrRecent(status: string, kickoffUtc: string, now: Date): boolean {
  if ((LIVE_STATUSES as readonly string[]).includes(status)) return true;

  if ((RECENT_FINISHED_STATUSES as readonly string[]).includes(status)) {
    const kickoffTime = new Date(kickoffUtc).getTime();
    const nowTime = now.getTime();
    return kickoffTime >= nowTime - RECENT_WINDOW_HOURS * 3600_000 && kickoffTime <= nowTime;
  }

  // Important 7: SCHEDULED/TIMED whose kickoff has passed within the grace
  // window — the gap between kickoff and ingestion catching up. Note the
  // direction: only *past* kickoffs count here. A SCHEDULED fixture whose
  // kickoff is still in the future belongs to the upcoming list, not here.
  if ((KICKOFF_GRACE_STATUSES as readonly string[]).includes(status)) {
    const kickoffTime = new Date(kickoffUtc).getTime();
    const nowTime = now.getTime();
    return kickoffTime <= nowTime && kickoffTime >= nowTime - KICKOFF_GRACE_MINUTES * 60_000;
  }

  // POSTPONED, CANCELLED, SUSPENDED: never live/recent for display.
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

  // Three queries merged in JS rather than one `.or()` string: PostgREST's `.or()` syntax
  // for this three-branch OR needs a hand-built nested and()/in() filter string that's
  // easy to get subtly wrong and can't be typo-checked by TypeScript. Three plain,
  // independently-readable queries plus a trivial JS merge+sort is clearer and just as
  // correct.
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
  // Important 7: the grace-window branch — see KICKOFF_GRACE_STATUSES above.
  let graceQuery = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .in('status', KICKOFF_GRACE_STATUSES)
    .gte('kickoff_utc', minutesAgo(now, KICKOFF_GRACE_MINUTES))
    .lte('kickoff_utc', now.toISOString());

  if (leagueIds && leagueIds.length > 0) {
    liveQuery = liveQuery.in('league_id', leagueIds);
    recentQuery = recentQuery.in('league_id', leagueIds);
    graceQuery = graceQuery.in('league_id', leagueIds);
  }

  const [live, recentFinished, grace] = await Promise.all([liveQuery, recentQuery, graceQuery]);
  if (live.error) throw new Error(`getLiveAndRecent: ${live.error.message}`);
  if (recentFinished.error) throw new Error(`getLiveAndRecent: ${recentFinished.error.message}`);
  if (grace.error) throw new Error(`getLiveAndRecent: ${grace.error.message}`);

  const merged = [
    ...(live.data ?? []),
    ...(recentFinished.data ?? []),
    ...(grace.data ?? []),
  ] as unknown as FixtureWithTeams[];
  merged.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  return merged;
}

/**
 * `leagueIds`, when given, scopes the query to those leagues *before* `limit`
 * is applied — the limit is a page size on an already-scoped result, not a
 * global cutoff filtered afterward. Getting that order backwards is exactly
 * Finding 1: `/scores` used to fetch an unscoped top-20 and filter it to the
 * selected league in JavaScript, so any league whose fixtures sorted past
 * global position 20 was truncated away before the filter ever saw them,
 * and the page rendered "Nothing scheduled" for a league that had real
 * fixtures in the database.
 *
 * `undefined` means every league (today's behaviour, unchanged). An
 * explicit empty array means every requested league code was unrecognised:
 * that must match nothing, not silently widen back to everything, so it
 * short-circuits before any query runs — same rule as `getLiveAndRecent`
 * and `getFixturesInRange` above, kept consistent for the same reason.
 */
export async function getUpcoming(now: Date, limit = 12, leagueIds?: number[]): Promise<FixtureWithTeams[]> {
  if (leagueIds && leagueIds.length === 0) return [];

  let q = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gt('kickoff_utc', now.toISOString())
    .in('status', ['SCHEDULED', 'TIMED'])
    .order('kickoff_utc', { ascending: true });
  if (leagueIds && leagueIds.length > 0) q = q.in('league_id', leagueIds);
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw new Error(`getUpcoming: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}

/**
 * How many fixtures are still to come, in total. The landing board shows a
 * fixed number of the soonest ones, and this is what lets it say so out
 * loud ("14 of 87 scheduled") instead of leaving a reader to wonder whether
 * the rest of the weekend exists. `head: true` means PostgREST returns the
 * count in a header and no rows at all, so this costs a count, not a page
 * of joined fixture data.
 *
 * Same status and time window as `getUpcoming`, deliberately: a count that
 * doesn't match the list it describes is worse than no count.
 */
export async function countUpcoming(now: Date): Promise<number> {
  const { count, error } = await readClient()
    .from('fixtures')
    .select('id', { count: 'exact', head: true })
    .gt('kickoff_utc', now.toISOString())
    .in('status', ['SCHEDULED', 'TIMED']);
  if (error) throw new Error(`countUpcoming: ${error.message}`);
  return count ?? 0;
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

/**
 * Every fixture involving one club, in kickoff order — both home and away,
 * which PostgREST expresses as an `.or()` across the two foreign keys.
 * Unlike `getUpcoming` this spans past and future in one call: a club page
 * wants "what just happened" and "what is next" from the same list, and
 * splitting them in the page (by kickoff against `now`) keeps the two
 * halves guaranteed consistent with each other.
 *
 * Every status is included, postponements and all: on a club's own page a
 * called-off match is information, not noise — `spineStateLabel` renders it
 * as "Postp." rather than hiding it.
 */
export async function getFixturesForTeam(teamId: number, limit = 60): Promise<FixtureWithTeams[]> {
  const { data, error } = await readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('kickoff_utc', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getFixturesForTeam: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}
