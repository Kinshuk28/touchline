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
