import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';
import { dedupeByKey } from '@/lib/db/dedupe';

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

/**
 * Deduped on `fd_id` (its conflict target) before the upsert — see
 * `lib/db/dedupe.ts`. A repeated `fd_id` in one call would otherwise make
 * Postgres reject the whole batch with "ON CONFLICT DO UPDATE command
 * cannot affect row a second time".
 */
export async function upsertTeams(rows: TeamRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => r.fd_id);
  const { error } = await serviceClient().from('teams').upsert(deduped, { onConflict: 'fd_id' });
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

export interface ClubIdentityRow {
  id: number;
  name: string;
  short_name: string | null;
  tla: string | null;
}

/**
 * Every club currently in a given league, with the identity fields
 * (`name`, `short_name`, `tla`) `matchFplTeamsToClubs`
 * (`lib/ingest/playerIdentity.ts`) needs to resolve an FPL team id onto our
 * internal `teams.id` — see that module for why all three fields matter.
 */
export async function getTeamsByLeagueId(leagueId: number): Promise<ClubIdentityRow[]> {
  return fetchAllRows<ClubIdentityRow>(
    'getTeamsByLeagueId',
    (from, to) =>
      serviceClient()
        .from('teams')
        .select('id, name, short_name, tla')
        .eq('league_id', leagueId)
        .order('id', { ascending: true })
        .range(from, to),
  );
}
