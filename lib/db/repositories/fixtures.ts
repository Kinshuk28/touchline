import { serviceClient } from '@/lib/db/client';
import type { WindowFixture } from '@/lib/ingest/matchWindow';
import type { FixtureStatus } from '@/lib/providers/types';

export interface FixtureRow {
  fd_id: number;
  league_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  season: number;
  kickoff_utc: string;
  status: string;
  matchday: number | null;
  home_goals: number | null;
  away_goals: number | null;
  half_time_home: number | null;
  half_time_away: number | null;
  last_updated: string | null;
  updated_at: string;
}

export async function upsertFixtures(rows: FixtureRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = serviceClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('fixtures').upsert(rows.slice(i, i + 500), { onConflict: 'fd_id' });
    if (error) throw new Error(`upsertFixtures: ${error.message}`);
  }
}

/**
 * Fixtures near enough to now that the guard needs to consider them.
 *
 * Deliberately left unpaginated: this queries an 8-hour kickoff window
 * (±4 hours) across the ~5 leagues this app tracks. Even a fixture-congested
 * day with every tracked league kicking off simultaneously is on the order of
 * tens of matches, nowhere near PostgREST's 1,000-row default select cap
 * (see `lib/db/paginate.ts`). Pagination here would be complexity with no
 * corresponding risk.
 */
export async function getWindowFixtures(now = new Date()): Promise<WindowFixture[]> {
  const from = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  const { data, error } = await serviceClient()
    .from('fixtures')
    .select('status, kickoff_utc')
    .gte('kickoff_utc', from)
    .lte('kickoff_utc', to);
  if (error) throw new Error(`getWindowFixtures: ${error.message}`);
  return (data ?? []).map((r) => ({
    status: r.status as FixtureStatus,
    kickoffUtc: r.kickoff_utc as string,
  }));
}
