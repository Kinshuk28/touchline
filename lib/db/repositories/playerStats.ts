import { serviceClient } from '@/lib/db/client';

export interface PlayerStatsRow {
  player_id: number;
  league_id: number;
  season: number;
  source: 'fpl' | 'football-data';
  appearances: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  expected_goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  updated_at: string;
}

export async function upsertPlayerSeasonStats(rows: PlayerStatsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = serviceClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('player_season_stats')
      .upsert(rows.slice(i, i + 500), { onConflict: 'player_id,season,source' });
    if (error) throw new Error(`upsertPlayerSeasonStats: ${error.message}`);
  }
}
