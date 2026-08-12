import { NextResponse } from 'next/server';
import { searchClubs, searchPlayers } from '@/lib/site/queries/search';
import { isSearchable, normalizeSearchQuery, sortByRelevance } from '@/lib/site/searchQuery';

export const dynamic = 'force-dynamic';

// A dropdown, not a results page — /search's own panels showed up to 20
// clubs and 40 players (lib/site/queries/search.ts's own caps). Six of each
// is what a keystroke-driven popover can show without scrolling itself,
// same reasoning components/NewsRail.tsx gives for capping tighter than the
// full-page /news feed it's a preview of.
const DROPDOWN_LIMIT = 6;

/**
 * Backs the live search box (components/SearchBox.tsx) — the replacement
 * for the old dedicated `/search` page, which required a full navigation
 * and a form submit to find out if a name matched anything. Same two
 * sources, same relevance ordering, same anon-key read-only client; the
 * only thing that changed is that this returns JSON for a keystroke handler
 * instead of HTML for a page load.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeSearchQuery(searchParams.get('q'));

  if (!isSearchable(query)) {
    return NextResponse.json({ clubs: [], players: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const [clubs, players] = await Promise.all([searchClubs(query), searchPlayers(query)]);
  const rankedClubs = sortByRelevance(clubs, query, (c) => c.short_name ?? c.name).slice(0, DROPDOWN_LIMIT);
  const rankedPlayers = sortByRelevance(players, query, (p) => p.name).slice(0, DROPDOWN_LIMIT);

  return NextResponse.json(
    { clubs: rankedClubs, players: rankedPlayers },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
