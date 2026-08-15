import { readClient } from '@/lib/site/supabase';
import type { ClubRow } from '@/lib/site/rows';
import type { ClubNameSource } from '@/lib/site/newsRelevance';

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

/**
 * Just the three name columns, for `lib/site/newsRelevance.ts`'s club
 * matcher — every club, current and historical, since a headline about a
 * relegated club is still a top-five-leagues story.
 *
 * Separate from `getTeams` rather than reusing it: relevance matching needs
 * three short strings per row, and `getTeams` selects eleven columns
 * including crest URLs and venues. This runs on the landing page alongside
 * five other queries, and there is no reason to pull ~10x the bytes for
 * data the matcher never reads.
 */
export async function getClubNames(): Promise<ClubNameSource[]> {
  const { data, error } = await readClient()
    .from('teams')
    .select('name,short_name,tla');
  if (error) throw new Error(`getClubNames: ${error.message}`);
  return (data ?? []) as ClubNameSource[];
}

/**
 * One club by its URL slug, or `null` when nothing matches — a `/team/xyz`
 * that isn't a club is a 404, not an error page, so this returns rather
 * than throws for the not-found case (an actual query failure still throws,
 * like every other query here).
 *
 * `maybeSingle()` rather than `single()`: `teams.slug` is `unique not null`
 * in the schema, so "no rows" is the only non-row outcome this can have,
 * and it is an expected one.
 */
export async function getTeamBySlug(slug: string): Promise<ClubRow | null> {
  const { data, error } = await readClient()
    .from('teams')
    .select(CLUB_FIELDS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`getTeamBySlug: ${error.message}`);
  return (data as unknown as ClubRow | null) ?? null;
}

/**
 * Every club entered in a competition for a season, via the `league_teams`
 * join table — not `teams.league_id` equality. Champions League clubs keep
 * their domestic `league_id` (Real Madrid stays a La Liga club there); this
 * is the only place their Champions League membership is recorded. See
 * `supabase/migrations/0013_league_teams.sql`.
 *
 * Ordered by `name`, matching `getTeams`, so a caller doesn't need its own
 * sort.
 */
export async function getClubsForCompetition(leagueId: number, season: number): Promise<ClubRow[]> {
  const { data, error } = await readClient()
    .from('league_teams')
    .select(`teams!inner(${CLUB_FIELDS})`)
    .eq('league_id', leagueId)
    .eq('season', season);
  if (error) throw new Error(`getClubsForCompetition: ${error.message}`);
  // Sorted here rather than via a `referencedTable` order clause: this
  // embed is a single related row per `league_teams` row (a belongs-to,
  // not a has-many), and ordering client-side avoids relying on how
  // PostgREST orders across parent rows for that shape.
  return ((data ?? []) as unknown as Array<{ teams: ClubRow }>)
    .map((r) => r.teams)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One club by internal id — what `/player/[slug]` needs to resolve
 * `players.team_id` into a name, crest and link. Same `null`-for-missing
 * contract as `getTeamBySlug`: `team_id` is nullable and can point at a row
 * that has since been removed, and neither is an error.
 */
export async function getTeamById(id: number): Promise<ClubRow | null> {
  const { data, error } = await readClient()
    .from('teams')
    .select(CLUB_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getTeamById: ${error.message}`);
  return (data as unknown as ClubRow | null) ?? null;
}
