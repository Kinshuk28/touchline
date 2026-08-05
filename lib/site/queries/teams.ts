import { readClient } from '@/lib/site/supabase';
import type { ClubRow } from '@/lib/site/rows';

/**
 * Every column `/clubs` needs (`lib/site/rows.ts#ClubRow` — see that type's
 * doc comment for why `venue`/`founded`/`club_colors` being null together
 * is the signal for a historical, no-longer-current club, not a gap to
 * patch over with a second query).
 */
const CLUB_FIELDS = 'id,fd_id,slug,name,short_name,tla,crest_url,venue,founded,club_colors,league_id';

/**
 * All 110 clubs — 96 current across the five covered competitions plus 14
 * retained for historical tables (see `ClubRow`'s doc comment). Ordered by
 * `name` so a caller grouping by competition gets a stable, alphabetical
 * order within each group without a second sort.
 *
 * Unlike `getStandings`, this deliberately takes no league/season
 * arguments: `/clubs` is the one page whose whole point is showing every
 * club, current and historical alike, in one place.
 */
export async function getTeams(): Promise<ClubRow[]> {
  const { data, error } = await readClient()
    .from('teams')
    .select(CLUB_FIELDS)
    .order('name', { ascending: true });
  if (error) throw new Error(`getTeams: ${error.message}`);
  return (data ?? []) as unknown as ClubRow[];
}
