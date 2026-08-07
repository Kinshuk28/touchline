import { userClient } from '@/lib/auth/session';

/**
 * Reading and writing one person's squad.
 *
 * Deliberately outside `lib/site/queries/`: everything in there reads public
 * football data with the anon key, and this reads and writes user data with
 * the signed-in user's own token. Keeping them apart makes it obvious at a
 * glance which client a query is using, and makes "the site never writes"
 * still true of `lib/site/`.
 *
 * NOTHING HERE IS THE SECURITY BOUNDARY. Every function takes a `userId`,
 * but no query trusts it: the access token is verified by Postgres and the
 * row-level security policies in supabase/migrations/0008 restrict every
 * statement to `auth.uid() = user_id`. The `userId` argument exists to fill
 * in the column on insert, and a wrong one is rejected by the `with check`
 * clause rather than quietly writing somebody else's row.
 */

export interface StoredPick {
  slot: number;
  playerId: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface StoredSquad {
  id: string;
  name: string;
  season: number;
  /** The generation these picks come from — `fantasy_pick.active_from_gameweek`. */
  activeFromGameweek: number;
  picks: StoredPick[];
}

export interface SquadInput {
  name: string;
  activeFromGameweek: number;
  picks: StoredPick[];
}

/**
 * The squad as it stands for a given gameweek — the newest generation saved
 * at or before it.
 *
 * A save writes a new generation rather than editing the old one (see the
 * history note in supabase/migrations/0008), so "what was my side in
 * gameweek 3" stays answerable after a change in gameweek 12.
 *
 * The whole squad's history is at most 15 × 38 rows, so it is fetched in one
 * query and grouped here. A window function would need a view, and a view
 * over user data would need its own RLS story for no practical gain.
 */
export async function getSquadForGameweek(
  accessToken: string,
  season: number,
  gameweek: number,
): Promise<StoredSquad | null> {
  const db = userClient(accessToken);

  const { data: squads, error: squadError } = await db
    .from('fantasy_squad')
    .select('id,name,season')
    .eq('season', season)
    .limit(1);
  if (squadError) throw new Error(`getSquadForGameweek (squad): ${squadError.message}`);

  const squad = (squads ?? [])[0] as { id: string; name: string; season: number } | undefined;
  if (!squad) return null;

  const { data: picks, error: pickError } = await db
    .from('fantasy_pick')
    .select('slot,player_id,is_captain,is_vice_captain,active_from_gameweek')
    .eq('squad_id', squad.id)
    .lte('active_from_gameweek', gameweek)
    .order('slot', { ascending: true });
  if (pickError) throw new Error(`getSquadForGameweek (picks): ${pickError.message}`);

  const rows = (picks ?? []) as Array<{
    slot: number; player_id: number; is_captain: boolean;
    is_vice_captain: boolean; active_from_gameweek: number;
  }>;
  if (rows.length === 0) {
    // A squad row with no picks yet — someone signed in and named a side
    // without finishing it. Real, and not an error.
    return { id: squad.id, name: squad.name, season: squad.season, activeFromGameweek: gameweek, picks: [] };
  }

  const generation = Math.max(...rows.map((r) => r.active_from_gameweek));
  return {
    id: squad.id,
    name: squad.name,
    season: squad.season,
    activeFromGameweek: generation,
    picks: rows
      .filter((r) => r.active_from_gameweek === generation)
      .map((r) => ({
        slot: r.slot,
        playerId: r.player_id,
        isCaptain: r.is_captain,
        isViceCaptain: r.is_vice_captain,
      })),
  };
}

/**
 * Create or replace the generation of picks starting at `activeFromGameweek`.
 *
 * Replacing rather than appending within a generation is what makes saving
 * twice before a deadline behave the way anyone would expect: the second
 * save is the side you meant, not fifteen extra rows fighting the first for
 * the same slots. Generations *before* this one are never touched — that is
 * the history the schema exists to keep.
 *
 * NOT A TRANSACTION, and honest about it: PostgREST has no transaction
 * across requests, so the delete and the insert below are two statements.
 * The window between them is one round trip, and a failure in it leaves the
 * generation empty rather than corrupted — the picker reads that as "no
 * squad yet" and offers to build one, which is recoverable. Making it atomic
 * needs a Postgres function, which is a reasonable follow-up and not worth
 * blocking the picker on.
 */
export async function saveSquad(
  accessToken: string,
  userId: string,
  season: number,
  input: SquadInput,
): Promise<string> {
  const db = userClient(accessToken);

  // `upsert` on (user_id, season) so a returning manager renames their side
  // rather than colliding with their own unique constraint.
  const { data: squadRow, error: squadError } = await db
    .from('fantasy_squad')
    .upsert(
      { user_id: userId, season, name: input.name, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,season' },
    )
    .select('id')
    .single();
  if (squadError) throw new Error(`saveSquad (squad): ${squadError.message}`);

  const squadId = (squadRow as { id: string }).id;

  const { error: deleteError } = await db
    .from('fantasy_pick')
    .delete()
    .eq('squad_id', squadId)
    .eq('active_from_gameweek', input.activeFromGameweek);
  if (deleteError) throw new Error(`saveSquad (clear generation): ${deleteError.message}`);

  const { error: insertError } = await db.from('fantasy_pick').insert(
    input.picks.map((pick) => ({
      squad_id: squadId,
      active_from_gameweek: input.activeFromGameweek,
      slot: pick.slot,
      player_id: pick.playerId,
      is_captain: pick.isCaptain,
      is_vice_captain: pick.isViceCaptain,
    })),
  );
  if (insertError) throw new Error(`saveSquad (picks): ${insertError.message}`);

  return squadId;
}
