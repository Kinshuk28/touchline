import { readClient } from '@/lib/site/supabase';
import type { StandingRow } from '@/lib/site/rows';

// Same field list as fixtures.ts's TEAM_FIELDS — every place a team is
// joined into a site query selects the same shape, so <Crest>, the
// club-colour bar (lib/site/clubColors.ts) and venue text all work
// identically regardless of which query the team came from. Direction Two's
// /tables spec calls out club_colors (row left-edge bar) and crest_url (the
// club crest) by name; the rest come along for free from staying consistent
// with the existing embed.
const TEAM_FIELDS = 'id,fd_id,slug,name,short_name,tla,crest_url,club_colors,venue';

/** One select, team joined — a crest or colour must never cost a second query. */
export function buildStandingSelect(): string {
  return [
    'league_id', 'team_id', 'season', 'position', 'played', 'won', 'drawn', 'lost',
    'goals_for', 'goals_against', 'goal_difference', 'points', 'form', 'updated_at',
    `team:team_id(${TEAM_FIELDS})`,
  ].join(',');
}

/**
 * One competition-season's table. Unlike the fixture queries, a table only
 * ever makes sense scoped to exactly one league and one season — there is
 * no "every league" or "every season" reading a caller could want, so both
 * arguments are required rather than optional filters.
 *
 * Ordered by `position` ascending, but that ordering is only meaningful for
 * a season with matches played: the 2026-27 rows (96 of the 192 in the live
 * table) are all `played = 0`, and their stored `position` is an ingestion
 * artifact, not a ranking — callers must not treat it as one. See
 * `lib/site/standingsDisplay.ts#sortStandingsForDisplay`, which re-sorts
 * alphabetically for an unplayed season rather than trusting this order.
 */
export async function getStandings(leagueId: number, season: number): Promise<StandingRow[]> {
  const { data, error } = await readClient()
    .from('standings')
    .select(buildStandingSelect())
    .eq('league_id', leagueId)
    .eq('season', season)
    .order('position', { ascending: true });
  if (error) throw new Error(`getStandings: ${error.message}`);
  return (data ?? []) as unknown as StandingRow[];
}
