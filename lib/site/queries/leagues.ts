import { readClient } from '@/lib/site/supabase';
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
