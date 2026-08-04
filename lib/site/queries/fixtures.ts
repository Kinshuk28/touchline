import { readClient } from '@/lib/site/supabase';
import type { FixtureWithTeams } from '@/lib/site/rows';

export const LIVE_STATUSES = ['IN_PLAY', 'PAUSED'] as const;
export const RECENT_WINDOW_HOURS = 6;

const TEAM_FIELDS = 'id,slug,name,short_name,tla,crest_url';

/** One select, both teams joined — a crest must never cost a second query. */
export function buildFixtureSelect(): string {
  return [
    'id', 'league_id', 'season', 'kickoff_utc', 'status', 'matchday',
    'home_goals', 'away_goals', 'updated_at',
    `home:home_team_id(${TEAM_FIELDS})`,
    `away:away_team_id(${TEAM_FIELDS})`,
  ].join(',');
}

function hoursAgo(now: Date, h: number): string {
  return new Date(now.getTime() - h * 3600_000).toISOString();
}

/** Anything in play, plus anything that finished recently enough to still matter. */
export async function getLiveAndRecent(now: Date): Promise<FixtureWithTeams[]> {
  const { data, error } = await readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gte('kickoff_utc', hoursAgo(now, RECENT_WINDOW_HOURS))
    .lte('kickoff_utc', now.toISOString())
    .order('kickoff_utc', { ascending: true });
  if (error) throw new Error(`getLiveAndRecent: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}

export async function getUpcoming(now: Date, limit = 12): Promise<FixtureWithTeams[]> {
  const { data, error } = await readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gt('kickoff_utc', now.toISOString())
    .in('status', ['SCHEDULED', 'TIMED'])
    .order('kickoff_utc', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getUpcoming: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}

export async function getFixturesInRange(
  fromIso: string,
  toIso: string,
  leagueIds?: number[],
): Promise<FixtureWithTeams[]> {
  let q = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gte('kickoff_utc', fromIso)
    .lte('kickoff_utc', toIso)
    .order('kickoff_utc', { ascending: true });
  if (leagueIds && leagueIds.length > 0) q = q.in('league_id', leagueIds);
  const { data, error } = await q;
  if (error) throw new Error(`getFixturesInRange: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}
