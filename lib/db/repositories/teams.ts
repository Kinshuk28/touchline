import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';

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
  const rows = await fetchAllRows<{ id: number; fd_id: number }>(
    'getTeamIdMap',
    (from, to) =>
      serviceClient().from('teams').select('id, fd_id').order('id', { ascending: true }).range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_id, r.id]));
}
