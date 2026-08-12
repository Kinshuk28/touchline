import { getTransferNews } from '@/lib/site/queries/news';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getClubNames } from '@/lib/site/queries/teams';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { TransfersRail } from '@/components/TransfersRail';
import { LeagueFilter } from '@/components/LeagueFilter';

// `searchParams` (the league filter) forces dynamic rendering, same
// reasoning as app/scores/page.tsx.
export const revalidate = 300;

// Well above the ~18 transfer-tagged items the database holds today (per
// the live-feedback brief), while still capping against unbounded growth —
// same reasoning as NEWS_FEED_LIMIT in app/news/page.tsx.
const TRANSFERS_FEED_LIMIT = 100;

export default async function TransfersPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  const selected = parseLeagueCodes(raw);
  const now = new Date();
  const leagues = await getLeagues();
  const leagueIds = selected.length > 0 ? resolveLeagueIds(leagues, selected) : undefined;

  const [feed, clubNames] = await Promise.all([
    getTransferNews(TRANSFERS_FEED_LIMIT, leagueIds),
    getClubNames(),
  ]);
  // Same relevance ordering as the landing rails and /news — a transfer
  // story about a club this site doesn't cover sinks below one that names a
  // stored club, and nothing is dropped (lib/site/newsRelevance.ts).
  const transfers = orderByRelevance(feed, buildClubIndex(clubNames));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Transfers</h1>
          {/* Honest labelling, not decoration: `news_items` has no structured
              transfer data — these are ordinary RSS/news stories tagged
              "transfer" by the ingest pipeline's category matching, nothing
              more. Never call these "confirmed" or imply a deal database
              exists behind this page. */}
          <p className="mt-1 max-w-prose text-sm text-muted">
            Reported transfer stories aggregated from publishers — not confirmed deals.
          </p>
        </div>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/transfers" />
      </div>
      {transfers.length > 0 ? (
        <TransfersRail items={transfers} leagues={leagues} now={now} />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          {/* Same distinction as app/news/page.tsx: a filter being active at
              all (`leagueIds !== undefined`), not just an unrecognised code
              resolving to nothing — a real league can legitimately have no
              transfer story right now without the whole feed being empty. */}
          {leagueIds !== undefined ? 'No transfer stories for that selection yet.' : 'No transfer stories yet.'}
        </p>
      )}
    </div>
  );
}
