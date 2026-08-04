import { NextResponse } from 'next/server';
import { getLiveAndRecent } from '@/lib/site/queries/fixtures';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const fixtures = await getLiveAndRecent(now);
  return NextResponse.json(
    {
      now: now.toISOString(),
      fixtures: fixtures.map((f) => ({
        id: f.id,
        status: f.status,
        home_goals: f.home_goals,
        away_goals: f.away_goals,
        updated_at: f.updated_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
