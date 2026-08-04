import { NextResponse } from 'next/server';
import { getLiveAndRecent } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const now = new Date();

  // Same comma-separated league-code format as the page's own `?leagues=`
  // (see LeagueFilter/app/scores/page.tsx) — no parameter means every
  // league, matching the page's own "no filter" meaning. Without this, the
  // poll loop silently re-widens to every competition regardless of what
  // the user filtered to on the page (Finding 1).
  const { searchParams } = new URL(request.url);
  const codes = parseLeagueCodes(searchParams.get('leagues'));
  const leagueIds = codes.length > 0 ? resolveLeagueIds(await getLeagues(), codes) : undefined;

  // Full FixtureWithTeams rows, not a thin score patch: a fixture that kicks
  // off after the page was rendered needs club names and crests to display
  // at all, and getLiveAndRecent already joins them — discarding the join
  // here is what let new fixtures vanish until a manual reload (see
  // lib/site/livePatch.ts). The payload is a handful of live matches, so
  // returning full rows costs almost nothing.
  const fixtures = await getLiveAndRecent(now, leagueIds);
  return NextResponse.json(
    { now: now.toISOString(), fixtures },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
