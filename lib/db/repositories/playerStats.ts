import { serviceClient } from '@/lib/db/client';
import { dedupeByKey } from '@/lib/db/dedupe';

export interface PlayerStatsRow {
  player_id: number;
  league_id: number;
  season: number;
  source: 'fpl' | 'football-data';
  appearances: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  expected_goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  updated_at: string;
}

/**
 * Deduped on the composite conflict target `player_id,season,source` across
 * the whole input before chunking into batches — see `lib/db/dedupe.ts`.
 * Deduping must happen before the chunk loop, not per-chunk, or a duplicate
 * pair that straddles a chunk boundary would still make Postgres reject
 * that chunk with "ON CONFLICT DO UPDATE command cannot affect row a
 * second time".
 */
export async function upsertPlayerSeasonStats(rows: PlayerStatsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.player_id}|${r.season}|${r.source}`);
  const db = serviceClient();
  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await db
      .from('player_season_stats')
      .upsert(deduped.slice(i, i + 500), { onConflict: 'player_id,season,source' });
    if (error) throw new Error(`upsertPlayerSeasonStats: ${error.message}`);
  }
}

/**
 * Moves every `player_season_stats` row from `fromPlayerId` to
 * `toPlayerId` — the step `scripts/repair/mergeFplPlayers.ts` must run
 * *before* deleting an orphan FPL player row, since `player_id` carries a
 * foreign key onto `players(id)`.
 *
 * The composite primary key `(player_id, season, source)` means the target
 * id can already hold a row at the same `(season, source)` — merging two
 * players who both happen to carry a stats row for the same season/source
 * would otherwise violate that key. Since this function only ever moves the
 * `fpl`-sourced row an orphan carries (orphans are FPL-only rows by
 * definition), the fpl row being moved is the one that should win: any
 * pre-existing row at the destination key is cleared first, then the
 * source row is repointed.
 */
export async function repointPlayerSeasonStats(fromPlayerId: number, toPlayerId: number): Promise<void> {
  const db = serviceClient();
  const { data: rows, error } = await db
    .from('player_season_stats')
    .select('season, source')
    .eq('player_id', fromPlayerId);
  if (error) throw new Error(`repointPlayerSeasonStats (read ${fromPlayerId}): ${error.message}`);

  for (const row of rows ?? []) {
    const { error: delErr } = await db
      .from('player_season_stats')
      .delete()
      .eq('player_id', toPlayerId)
      .eq('season', row.season)
      .eq('source', row.source);
    if (delErr) {
      throw new Error(
        `repointPlayerSeasonStats (clear destination ${toPlayerId}/${row.season}/${row.source}): ${delErr.message}`,
      );
    }

    const { error: updErr } = await db
      .from('player_season_stats')
      .update({ player_id: toPlayerId })
      .eq('player_id', fromPlayerId)
      .eq('season', row.season)
      .eq('source', row.source);
    if (updErr) {
      throw new Error(
        `repointPlayerSeasonStats (move ${fromPlayerId} -> ${toPlayerId}, ${row.season}/${row.source}): ${updErr.message}`,
      );
    }
  }
}
