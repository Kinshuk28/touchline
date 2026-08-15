import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';
import { dedupeByKey } from '@/lib/db/dedupe';

export interface TeamRow {
  fd_id: number;
  // Nullable: a club with no *domestic* league on file — either a
  // historical club dropped out of every tracked competition
  // (scripts/backfill.ts phase 3), or a Champions League club whose
  // domestic league this project doesn't track at all
  // (scripts/ingest/continental.ts). Its continental membership, if any,
  // lives in `league_teams` instead — see supabase/migrations/0013_league_teams.sql.
  league_id: number | null;
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

/**
 * Every club's identity and current competition — what news tagging needs
 * to match a headline and attribute it (lib/ingest/newsTagging.ts).
 *
 * All 110 rows, including the 14 with a null `league_id` retained for
 * historical tables: a headline about a relegated club is still about that
 * club, and tagging it is what makes its club page work.
 */
export async function getAllClubIdentities(): Promise<Array<{
  id: number;
  name: string;
  short_name: string | null;
  tla: string | null;
  league_id: number | null;
}>> {
  const { data, error } = await serviceClient()
    .from('teams')
    .select('id,name,short_name,tla,league_id');
  if (error) throw new Error(`getAllClubIdentities: ${error.message}`);
  return (data ?? []) as Array<{ id: number; name: string; short_name: string | null; tla: string | null; league_id: number | null }>;
}
