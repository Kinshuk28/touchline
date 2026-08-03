import { serviceClient } from '@/lib/db/client';

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

export async function upsertPlayersByFdId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('players').upsert(rows, { onConflict: 'fd_id' });
  if (error) throw new Error(`upsertPlayersByFdId: ${error.message}`);
}

export async function upsertPlayersByFplId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('players').upsert(rows, { onConflict: 'fpl_id' });
  if (error) throw new Error(`upsertPlayersByFplId: ${error.message}`);
}

export async function getPlayerIdByFplId(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient()
    .from('players').select('id, fpl_id').not('fpl_id', 'is', null);
  if (error) throw new Error(`getPlayerIdByFplId: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fpl_id as number, r.id as number]));
}

export async function getPlayerIdByFdId(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient()
    .from('players').select('id, fd_id').not('fd_id', 'is', null);
  if (error) throw new Error(`getPlayerIdByFdId: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_id as number, r.id as number]));
}
