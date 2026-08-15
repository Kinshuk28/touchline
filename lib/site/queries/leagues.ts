import { readClient } from '@/lib/site/supabase';
import type { LeagueRow } from '@/lib/site/rows';

const ORDER: Record<string, number> = { PL: 0, PD: 1, SA: 2, BL1: 3, FL1: 4, CL: 5 };

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

export interface KickoffCandidate {
  league_id: number;
  kickoff_utc: string;
  status: string;
}

/**
 * Statuses whose kickoff can still actually happen — the same rule
 * `getUpcoming` (lib/site/queries/fixtures.ts) already applies. A POSTPONED
 * or CANCELLED fixture keeps its *original* kickoff_utc, which can sort
 * earlier than the real next match; without this filter the countdown
 * points at a match that will never be played (Finding 1).
 */
const KICKOFF_STATUSES = ['SCHEDULED', 'TIMED'] as const;

/**
 * The earliest-per-league reduction behind getNextKickoffPerLeague, extracted
 * so it is unit-testable without a database. Filtering here (not only in the
 * query) is what the Finding 1 regression test exercises directly.
 */
export function earliestKickoffPerLeague(
  leagues: LeagueRow[],
  fixtures: KickoffCandidate[],
): Array<{ league: LeagueRow; kickoffUtc: string | null }> {
  const earliest = new Map<number, string>();
  for (const f of fixtures) {
    if (!(KICKOFF_STATUSES as readonly string[]).includes(f.status)) continue;
    const seen = earliest.get(f.league_id);
    if (seen === undefined || f.kickoff_utc < seen) earliest.set(f.league_id, f.kickoff_utc);
  }
  return leagues.map((league) => ({ league, kickoffUtc: earliest.get(league.id) ?? null }));
}

/**
 * Earliest scheduled kickoff per competition — drives the preseason
 * countdown.
 *
 * Selects only `league_id,kickoff_utc,status` — never `buildFixtureSelect()`
 * — and scopes to `KICKOFF_STATUSES` server-side too. The previous version
 * called `getFixturesInRange`, which pulls every status across a 60-day,
 * all-league window with both teams joined (251 rows measured) purely to
 * derive five scalar dates (Finding 2). One query for the two columns this
 * needs, reduced in JS, is simpler to read than five per-league queries and
 * just as correct.
 */
export async function getNextKickoffPerLeague(
  now: Date,
): Promise<Array<{ league: LeagueRow; kickoffUtc: string | null }>> {
  const leagues = await getLeagues();
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const { data, error } = await readClient()
    .from('fixtures')
    .select('league_id,kickoff_utc,status')
    .gte('kickoff_utc', now.toISOString())
    .lte('kickoff_utc', to.toISOString())
    .in('status', KICKOFF_STATUSES);
  if (error) throw new Error(`getNextKickoffPerLeague: ${error.message}`);
  return earliestKickoffPerLeague(leagues, (data ?? []) as KickoffCandidate[]);
}
