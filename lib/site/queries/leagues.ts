import { readClient } from '@/lib/site/supabase';
import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import type { LeagueRow } from '@/lib/site/rows';

const ORDER: Record<string, number> = { PL: 0, PD: 1, SA: 2, BL1: 3, FL1: 4 };

/** Presentation order is the conventional one, not alphabetical or by id. */
export async function getLeagues(): Promise<LeagueRow[]> {
  const { data, error } = await readClient()
    .from('leagues')
    .select('id,fd_code,slug,name,country,emblem_url,current_season');
  if (error) throw new Error(`getLeagues: ${error.message}`);
  return ((data ?? []) as LeagueRow[])
    .slice()
    .sort((a, b) => (ORDER[a.fd_code] ?? 99) - (ORDER[b.fd_code] ?? 99));
}

/** Earliest scheduled kickoff per competition — drives the preseason countdown. */
export async function getNextKickoffPerLeague(
  now: Date,
): Promise<Array<{ league: LeagueRow; kickoffUtc: string | null }>> {
  const leagues = await getLeagues();
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString());
  const earliest = new Map<number, string>();
  for (const f of fixtures) {
    const seen = earliest.get(f.league_id);
    if (seen === undefined || f.kickoff_utc < seen) earliest.set(f.league_id, f.kickoff_utc);
  }
  return leagues.map((league) => ({ league, kickoffUtc: earliest.get(league.id) ?? null }));
}
