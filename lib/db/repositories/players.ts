import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';
import { dedupeByKey } from '@/lib/db/dedupe';

const BATCH_SIZE = 500;

export interface PlayerRow {
  fd_id: number | null;
  fpl_id: number | null;
  team_id: number | null;
  slug: string;
  name: string;
  position: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  photo_url: string | null;
}

/**
 * Both player upserts dedupe on their conflict key across the *whole* input
 * before chunking into batches. A player who appears twice in one call (e.g.
 * two clubs' squads both listing them, because they transferred mid-window)
 * would otherwise make Postgres reject an entire batch with "ON CONFLICT DO
 * UPDATE command cannot affect row a second time" — deduping per-chunk would
 * still miss a duplicate pair that straddles a chunk boundary. See
 * `lib/db/dedupe.ts` for the full story (this is the bug that zeroed out
 * player writes in the live phase-a backfill).
 */
export async function upsertPlayersByFdId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => r.fd_id ?? `null-${r.slug}`);
  const db = serviceClient();
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const { error } = await db.from('players').upsert(deduped.slice(i, i + BATCH_SIZE), { onConflict: 'fd_id' });
    if (error) throw new Error(`upsertPlayersByFdId: ${error.message}`);
  }
}

export async function upsertPlayersByFplId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => r.fpl_id ?? `null-${r.slug}`);
  const db = serviceClient();
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const { error } = await db.from('players').upsert(deduped.slice(i, i + BATCH_SIZE), { onConflict: 'fpl_id' });
    if (error) throw new Error(`upsertPlayersByFplId: ${error.message}`);
  }
}

export async function getPlayerIdByFplId(): Promise<Map<number, number>> {
  const rows = await fetchAllRows<{ id: number; fpl_id: number }>(
    'getPlayerIdByFplId',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, fpl_id')
        .not('fpl_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  );
  return new Map(rows.map((r) => [r.fpl_id, r.id]));
}

export async function getPlayerIdByFdId(): Promise<Map<number, number>> {
  const rows = await fetchAllRows<{ id: number; fd_id: number }>(
    'getPlayerIdByFdId',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, fd_id')
        .not('fd_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_id, r.id]));
}

/**
 * Existing football-data-sourced players (`fd_id` not null, no `fpl_id` yet)
 * belonging to one of the given clubs — the match target for
 * `matchPlayersTiered` (`lib/ingest/playerMatch.ts`) when resolving FPL
 * identity onto an already-existing row instead of inserting a parallel one.
 * `team_id` is included (not just `id`/`name`) because the tiered matcher
 * scopes its within-club ambiguity check to it — a bare surname is only
 * (nearly) unique *within* a club, not league-wide.
 *
 * Excluding rows that already carry an `fpl_id` keeps a second run (or the
 * repair script re-matching against rows the recurring job already merged)
 * from re-selecting an already-claimed row as a match target — `fpl_id` is
 * `unique`, so a stale candidate here could otherwise silently steal another
 * player's identity instead of leaving a genuine miss reported as unmatched.
 */
export async function getFdPlayersByTeamIds(
  teamIds: readonly number[],
): Promise<Array<{ id: number; name: string; team_id: number }>> {
  if (teamIds.length === 0) return [];
  return fetchAllRows<{ id: number; name: string; team_id: number }>(
    'getFdPlayersByTeamIds',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, name, team_id')
        .not('fd_id', 'is', null)
        .is('fpl_id', null)
        .in('team_id', teamIds as number[])
        .order('id', { ascending: true })
        .range(from, to),
  );
}

/**
 * FPL-path "orphan" rows: created before the identity-resolution fix (or by
 * a genuine FPL-side miss since), carrying `fpl_id` but no `fd_id` and no
 * `team_id`. The one-shot repair (`scripts/repair/mergeFplPlayers.ts`)
 * reads these to retry the same match against players that already exist.
 */
export async function getOrphanFplPlayers(): Promise<
  Array<{ id: number; name: string; fpl_id: number; photo_url: string | null }>
> {
  return fetchAllRows<{ id: number; name: string; fpl_id: number; photo_url: string | null }>(
    'getOrphanFplPlayers',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, name, fpl_id, photo_url')
        .is('fd_id', null)
        .not('fpl_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  );
}

/**
 * Writes the FPL half of a player's identity (`fpl_id`, `photo_url`) onto an
 * *existing* row without touching `fd_id`, `team_id`, `slug` or `name` — the
 * targeted update `scripts/ingest/players.ts` and the repair script use for
 * a name match, as opposed to `upsertPlayersByFplId`, which is for rows that
 * genuinely don't exist yet. A plain per-row `.update()` rather than a bulk
 * upsert: an upsert keyed on `id` would need every `not null` column in the
 * payload (Postgres validates the attempted INSERT's row before it ever
 * reaches the `ON CONFLICT` branch), which would mean re-sending `slug` and
 * `name` we didn't actually change.
 */
export async function setPlayerFplIdentity(
  rows: readonly { id: number; fpl_id: number; photo_url: string | null }[],
): Promise<void> {
  const db = serviceClient();
  for (const r of rows) {
    const { error } = await db.from('players').update({ fpl_id: r.fpl_id, photo_url: r.photo_url }).eq('id', r.id);
    if (error) throw new Error(`setPlayerFplIdentity: ${error.message}`);
  }
}

/** Sets `team_id` on existing rows — used to un-orphan FPL players whose FPL team resolved but who had no football-data match to inherit a club from. */
export async function setPlayerTeam(rows: readonly { id: number; team_id: number }[]): Promise<void> {
  const db = serviceClient();
  for (const r of rows) {
    const { error } = await db.from('players').update({ team_id: r.team_id }).eq('id', r.id);
    if (error) throw new Error(`setPlayerTeam: ${error.message}`);
  }
}

/** Deletes players by internal id — used by the repair script once an orphan's identity and stats have been moved onto its football-data match. */
export async function deletePlayersByIds(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await serviceClient().from('players').delete().in('id', ids as number[]);
  if (error) throw new Error(`deletePlayersByIds: ${error.message}`);
}
