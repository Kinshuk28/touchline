import { NextResponse } from 'next/server';
import { getLiveAndRecent } from '@/lib/site/queries/fixtures';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  // Full FixtureWithTeams rows, not a thin score patch: a fixture that kicks
  // off after the page was rendered needs club names and crests to display
  // at all, and getLiveAndRecent already joins them — discarding the join
  // here is what let new fixtures vanish until a manual reload (see
  // lib/site/livePatch.ts). The payload is a handful of live matches, so
  // returning full rows costs almost nothing.
  const fixtures = await getLiveAndRecent(now);
  return NextResponse.json(
    { now: now.toISOString(), fixtures },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
