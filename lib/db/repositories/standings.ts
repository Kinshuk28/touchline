import { serviceClient } from '@/lib/db/client';
import { dedupeByKey } from '@/lib/db/dedupe';

export interface StandingRow {
  league_id: number;
  team_id: number;
  season: number;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form: string | null;
  updated_at: string;
}

/**
 * Deduped on the composite conflict target `league_id,season,team_id`
 * before the upsert — see `lib/db/dedupe.ts`. A repeated composite key in
 * one call would otherwise make Postgres reject the whole batch with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 */
export async function upsertStandings(rows: StandingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.league_id}|${r.season}|${r.team_id}`);
  const { error } = await serviceClient()
    .from('standings')
    .upsert(deduped, { onConflict: 'league_id,season,team_id' });
  if (error) throw new Error(`upsertStandings: ${error.message}`);
}
