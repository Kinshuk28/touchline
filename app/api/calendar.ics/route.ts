import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { buildIcs } from '@/lib/site/ics';

// Deliberately NOT `export const revalidate = N`. This handler reads
// `request.url` to get the `leagues` filter, and touching the Request
// object is a Dynamic API — Next.js therefore renders it fresh per request
// regardless of any `revalidate` export (verified: the production build
// marks this route `ƒ Dynamic`, and responses carry no Cache-Control or
// x-nextjs-cache header). A `revalidate` export here would be dead code at
// best; at worst, a future refactor that stops touching the Request object
// would silently resurrect Next's Full Route Cache, which for a static
// Route Handler keys on pathname only — every `?leagues=` variant would
// collapse onto one cached response and one user's filtered calendar could
// be served to another. `force-dynamic` + `no-store` states the requirement
// explicitly instead of relying on the incidental side effect, matching
// `/api/live`'s own handling of this exact hazard for the same query param.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codes = parseLeagueCodes(url.searchParams.get('leagues'));

  const leagues = await getLeagues();
  const ids = codes.length > 0 ? resolveLeagueIds(leagues, codes) : undefined;

  const now = new Date();
  const to = new Date(now.getTime() + 120 * 86_400_000);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString(), ids);

  const nameById = new Map(leagues.map((l) => [l.id, l.name]));
  const body = buildIcs(fixtures, (id) => nameById.get(id) ?? 'Football');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="touchline.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
