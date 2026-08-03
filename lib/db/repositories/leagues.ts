import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';
import { dedupeByKey } from '@/lib/db/dedupe';

export interface LeagueRow {
  fd_code: string;
  fd_id: number;
  slug: string;
  name: string;
  country: string;
  emblem_url: string | null;
  current_season: number;
  season_start: string | null;
  season_end: string | null;
}

/**
 * Deduped on `fd_code` (its conflict target) before the upsert — see
 * `lib/db/dedupe.ts`. A repeated `fd_code` in one call would otherwise make
 * Postgres reject the whole batch with "ON CONFLICT DO UPDATE command
 * cannot affect row a second time".
 */
export async function upsertLeagues(rows: LeagueRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => r.fd_code);
  const { error } = await serviceClient()
    .from('leagues')
    .upsert(deduped, { onConflict: 'fd_code' });
  if (error) throw new Error(`upsertLeagues: ${error.message}`);
}

export async function getLeagueIdMap(): Promise<Map<string, number>> {
  const rows = await fetchAllRows<{ id: number; fd_code: string }>(
    'getLeagueIdMap',
    (from, to) =>
      serviceClient().from('leagues').select('id, fd_code').order('id', { ascending: true }).range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_code, r.id]));
}
