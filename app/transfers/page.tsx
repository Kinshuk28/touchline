import { getTransferNews } from '@/lib/site/queries/news';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getClubNames } from '@/lib/site/queries/teams';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { TransfersRail } from '@/components/TransfersRail';

export const revalidate = 300;

// Well above the ~18 transfer-tagged items the database holds today (per
// the live-feedback brief), while still capping against unbounded growth —
// same reasoning as NEWS_FEED_LIMIT in app/news/page.tsx.
const TRANSFERS_FEED_LIMIT = 100;

export default async function TransfersPage() {
  const now = new Date();
  const [feed, leagues, clubNames] = await Promise.all([
    getTransferNews(TRANSFERS_FEED_LIMIT),
    getLeagues(),
    getClubNames(),
  ]);
  // Same relevance ordering as the landing rails and /news — a transfer
  // story about a club this site doesn't cover sinks below one that names a
  // stored club, and nothing is dropped (lib/site/newsRelevance.ts).
  const transfers = orderByRelevance(feed, buildClubIndex(clubNames));

  return (
    <div className="space-y-4">
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
      {transfers.length > 0 ? (
        <TransfersRail items={transfers} leagues={leagues} now={now} />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No transfer stories yet.
        </p>
      )}
    </div>
  );
}
