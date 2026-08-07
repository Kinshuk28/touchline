import { readClient } from '@/lib/site/supabase';
import { likeContains } from '@/lib/site/searchQuery';
import type { ClubRow } from '@/lib/site/rows';
import type { SquadPlayer } from '@/lib/site/queries/players';

// A search page shows a page of results, not a database dump. Both caps are
// generous enough that a real query never hits them and small enough that a
// one-letter query (which `isSearchable` rejects anyway) could not become a
// 110-row and 3,000-row response.
const CLUB_LIMIT = 20;
const PLAYER_LIMIT = 40;

/**
 * Clubs whose name, short name or three-letter code contains the query.
 *
 * Three separate `.ilike()` queries merged in JavaScript rather than one
 * `.or()`, deliberately: `.or()` takes a filter *string* with the value
 * interpolated into it, so a query containing a comma or a parenthesis
 * changes the filter's structure instead of what it searches for. One
 * column per query has no such seam — see lib/site/searchQuery.ts.
 */
export async function searchClubs(query: string): Promise<ClubRow[]> {
  const pattern = likeContains(query);
  const columns = 'id,fd_id,slug,name,short_name,tla,crest_url,venue,founded,club_colors,league_id';

  const [byName, byShort, byTla] = await Promise.all([
    readClient().from('teams').select(columns).ilike('name', pattern).limit(CLUB_LIMIT),
    readClient().from('teams').select(columns).ilike('short_name', pattern).limit(CLUB_LIMIT),
    readClient().from('teams').select(columns).ilike('tla', pattern).limit(CLUB_LIMIT),
  ]);
  for (const res of [byName, byShort, byTla]) {
    if (res.error) throw new Error(`searchClubs: ${res.error.message}`);
  }

  // A club matching on two columns must appear once.
  const byId = new Map<number, ClubRow>();
  for (const row of [...(byName.data ?? []), ...(byShort.data ?? []), ...(byTla.data ?? [])] as unknown as ClubRow[]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()].slice(0, CLUB_LIMIT);
}

/** Players whose name contains the query. One column, so one query. */
export async function searchPlayers(query: string): Promise<SquadPlayer[]> {
  const { data, error } = await readClient()
    .from('players')
    .select('id,slug,name,position,nationality')
    .ilike('name', likeContains(query))
    .limit(PLAYER_LIMIT);
  if (error) throw new Error(`searchPlayers: ${error.message}`);
  return (data ?? []) as SquadPlayer[];
}
