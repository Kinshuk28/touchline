import { serviceClient } from '@/lib/db/client';

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

export async function upsertStandings(rows: StandingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient()
    .from('standings')
    .upsert(rows, { onConflict: 'league_id,season,team_id' });
  if (error) throw new Error(`upsertStandings: ${error.message}`);
}
