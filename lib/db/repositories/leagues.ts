import { serviceClient } from '@/lib/db/client';

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

export async function upsertLeagues(rows: LeagueRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient()
    .from('leagues')
    .upsert(rows, { onConflict: 'fd_code' });
  if (error) throw new Error(`upsertLeagues: ${error.message}`);
}

export async function getLeagueIdMap(): Promise<Map<string, number>> {
  const { data, error } = await serviceClient().from('leagues').select('id, fd_code');
  if (error) throw new Error(`getLeagueIdMap: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_code as string, r.id as number]));
}
