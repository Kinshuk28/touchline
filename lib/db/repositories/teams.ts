import { serviceClient } from '@/lib/db/client';

export interface TeamRow {
  fd_id: number;
  league_id: number;
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
  venue: string | null;
  founded: number | null;
  club_colors: string | null;
}

export async function upsertTeams(rows: TeamRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('teams').upsert(rows, { onConflict: 'fd_id' });
  if (error) throw new Error(`upsertTeams: ${error.message}`);
}

export async function getTeamIdMap(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient().from('teams').select('id, fd_id');
  if (error) throw new Error(`getTeamIdMap: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_id as number, r.id as number]));
}
