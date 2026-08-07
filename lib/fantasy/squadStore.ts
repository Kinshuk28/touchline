import { userClient } from '@/lib/auth/session';
import type { TransferRecord } from '@/lib/fantasy/transfers';
import type { Chip } from '@/lib/fantasy/chips';

/**
 * Reading and writing one person's squad.
 *
 * Deliberately outside `lib/site/queries/`: everything in there reads public
 * football data with the anon key, and this reads and writes user data with
 * the signed-in user's own token. Keeping them apart makes it obvious at a
 * glance which client a query is using, and makes "the site never writes"
 * still true of `lib/site/`.
 *
 * THE SECURITY BOUNDARY IS POSTGRES, NOT THIS FILE. The access token is
 * verified by the database and the policies in supabase/migrations/0008
 * restrict every statement to `auth.uid() = user_id`. A wrong `userId`
 * passed to `saveSquad` is rejected by the `with check` clause rather than
 * quietly writing somebody else's row.
 *
 * The reads below *also* filter on `user_id` explicitly. That is redundant
 * with the policy, deliberately: it costs one indexed predicate, and it
 * means a future policy edit that widens `fantasy_squad` — 0009 widens it
 * to league-mates, and there will be more — cannot silently turn "your
 * squad" into "somebody's squad". A query that says which rows it wants is
 * also a query whose intent survives being read a year later.
 */

export interface StoredPick {
  slot: number;
  playerId: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  /**
   * What this player cost when bought (tenths of a million). `null` for picks
   * written before supabase/migrations/0010 — readers fall back to the
   * current price rather than inventing a number.
   */
  priceTenths: number | null;
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
  /** How many players came in, and what the extras cost. See lib/fantasy/transfers.ts. */
  transfersMade: number;
  transferCost: number;
  /** The chip played this gameweek, or null. See lib/fantasy/chips.ts. */
  chip: Chip | null;
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
  userId: string,
  season: number,
  gameweek: number,
): Promise<StoredSquad | null> {
  const db = userClient(accessToken);

  const { data: squads, error: squadError } = await db
    .from('fantasy_squad')
    .select('id,name,season')
    .eq('user_id', userId)
    .eq('season', season)
    .limit(1);
  if (squadError) throw new Error(`getSquadForGameweek (squad): ${squadError.message}`);

  const squad = (squads ?? [])[0] as { id: string; name: string; season: number } | undefined;
  if (!squad) return null;

  const { data: picks, error: pickError } = await db
    .from('fantasy_pick')
    .select('slot,player_id,is_captain,is_vice_captain,active_from_gameweek,price_tenths')
    .eq('squad_id', squad.id)
    .lte('active_from_gameweek', gameweek)
    .order('slot', { ascending: true });
  if (pickError) throw new Error(`getSquadForGameweek (picks): ${pickError.message}`);

  const rows = (picks ?? []) as Array<{
    slot: number; player_id: number; is_captain: boolean;
    is_vice_captain: boolean; active_from_gameweek: number; price_tenths: number | null;
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
        priceTenths: r.price_tenths,
      })),
  };
}

/**
 * Every gameweek this manager saved a side for, and how many changes each
 * made — the input `transferAllowance` needs to know how many free transfers
 * are banked.
 *
 * Gameweeks with no row are gameweeks where the previous side simply carried:
 * nothing changed, nothing was spent, and a transfer accrued. That is why
 * this returns only what was saved rather than a row per gameweek.
 */
export async function getTransferHistory(
  accessToken: string,
  squadId: string,
): Promise<TransferRecord[]> {
  const { data, error } = await userClient(accessToken)
    .from('fantasy_squad_gameweek')
    .select('gameweek,transfers_made,chip')
    .eq('squad_id', squadId)
    .order('gameweek', { ascending: true });
  if (error) throw new Error(`getTransferHistory: ${error.message}`);
  return ((data ?? []) as Array<{ gameweek: number; transfers_made: number; chip: Chip | null }>)
    .map((row) => ({ gameweek: row.gameweek, transfersMade: row.transfers_made, chip: row.chip }));
}

/**
 * Which chips this squad has played, and when — the input `availableChips`
 * needs.
 *
 * Reads the same rows as `getTransferHistory` but is kept separate because
 * the two answer different questions and one is often wanted without the
 * other; the partial index in 0011 serves this one directly.
 */
export async function getChipsPlayed(
  accessToken: string,
  squadId: string,
): Promise<Array<{ gameweek: number; chip: Chip }>> {
  const { data, error } = await userClient(accessToken)
    .from('fantasy_squad_gameweek')
    .select('gameweek,chip')
    .eq('squad_id', squadId)
    .not('chip', 'is', null)
    .order('gameweek', { ascending: true });
  if (error) throw new Error(`getChipsPlayed: ${error.message}`);
  return ((data ?? []) as Array<{ gameweek: number; chip: Chip | null }>)
    .flatMap((row) => (row.chip === null ? [] : [{ gameweek: row.gameweek, chip: row.chip }]));
}

/** The chip played in one gameweek, or null. Used to tell a Free Hit side from an ordinary one. */
export async function getChipForGameweek(
  accessToken: string,
  squadId: string,
  gameweek: number,
): Promise<Chip | null> {
  const { data, error } = await userClient(accessToken)
    .from('fantasy_squad_gameweek')
    .select('chip')
    .eq('squad_id', squadId)
    .eq('gameweek', gameweek)
    .maybeSingle();
  if (error) throw new Error(`getChipForGameweek: ${error.message}`);
  return (data as { chip: Chip | null } | null)?.chip ?? null;
}

/** The squad row for this user and season, or null. Used before a save to diff against. */
export async function getSquadId(
  accessToken: string,
  userId: string,
  season: number,
): Promise<string | null> {
  const { data, error } = await userClient(accessToken)
    .from('fantasy_squad')
    .select('id')
    .eq('user_id', userId)
    .eq('season', season)
    .maybeSingle();
  if (error) throw new Error(`getSquadId: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
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
      price_tenths: pick.priceTenths,
    })),
  );
  if (insertError) throw new Error(`saveSquad (picks): ${insertError.message}`);

  // The gameweek's transfer record. Upserted, not inserted: saving twice
  // before a deadline recomputes the changes against the previous
  // *generation*, so the second save's figure replaces the first's rather
  // than adding to it — which is what makes changing your mind before the
  // deadline free, as it should be.
  const { error: recordError } = await db
    .from('fantasy_squad_gameweek')
    .upsert(
      {
        squad_id: squadId,
        gameweek: input.activeFromGameweek,
        transfers_made: input.transfersMade,
        transfer_cost: input.transferCost,
        chip: input.chip,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'squad_id,gameweek' },
    );
  if (recordError) throw new Error(`saveSquad (transfers): ${recordError.message}`);

  return squadId;
}
