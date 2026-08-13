import { serviceClient } from '@/lib/db/client';
import { dedupeByKey } from '@/lib/db/dedupe';

export interface LeagueTeamRow {
  league_id: number;
  team_id: number;
  season: number;
  updated_at: string;
}

/**
 * A club's membership in a competition it does NOT hold as its single
 * `teams.league_id` — Champions League today. See
 * `supabase/migrations/0013_league_teams.sql` for why this is a separate
 * many-to-many table rather than another write to `teams.league_id`.
 *
 * Deduped on the composite conflict target `league_id,team_id,season`
 * before the upsert — see `lib/db/dedupe.ts`. A repeated composite key in
 * one call would otherwise make Postgres reject the whole batch with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 */
export async function upsertLeagueTeams(rows: LeagueTeamRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.league_id}|${r.team_id}|${r.season}`);
  const { error } = await serviceClient()
    .from('league_teams')
    .upsert(deduped, { onConflict: 'league_id,team_id,season' });
  if (error) throw new Error(`upsertLeagueTeams: ${error.message}`);
}
