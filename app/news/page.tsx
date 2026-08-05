import { getTrendingNews } from '@/lib/site/queries/news';
import { getClubNames } from '@/lib/site/queries/teams';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { NewsCard } from '@/components/NewsCard';

// Same 5-minute cap as the landing page (app/page.tsx) — comfortably below
// the ingest cadence, and this route has no dynamic per-request input (no
// cookie read, no searchParams) so it's actually ISR-eligible, unlike
// the landing page's own inert `revalidate`.
export const revalidate = 300;

// Capped, not paginated (spec: "paginated or capped at a sensible number").
// A football aggregator's feed churns fast enough — ingestion runs every 15
// minutes — that a "page 2" link would mostly point at stories that are
// already stale; one generous cap over a single scroll's worth is simpler
// and doesn't need any new UI for page controls.
const NEWS_FEED_LIMIT = 60;

export default async function NewsPage() {
  const now = new Date();
  const [feed, clubNames] = await Promise.all([
    getTrendingNews(NEWS_FEED_LIMIT),
    getClubNames(),
  ]);
  // The spec's relevance rule applies "wherever news appears", and this
  // feed is where it was most visible: newest-first led with "Vozinha
  // granted shirt name exemption by Chile FA" on a site that covers the top
  // five European leagues. Ordering only — every fetched item is still
  // rendered, in recency order inside each tier, so nothing a reader could
  // have seen before disappears (lib/site/newsRelevance.ts).
  const news = orderByRelevance(feed, buildClubIndex(clubNames));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">News</h1>
      {/* The full feed, so it keeps components/NewsCard.tsx — image-led at
          16:9 with a type-only fallback for the items that have no stored
          image (the Guardian stores none at all; that's expected, not a gap
          to fill). The landing page's own rail is a different, much denser
          component (components/NewsRail.tsx) precisely because eight of
          these cards would be 1800px of column. Club-relevant stories
          first, newest-first within that. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {news.map((n) => <NewsCard key={n.id} item={n} now={now} />)}
        {news.length === 0 && (
          <p className="text-sm text-muted">No headlines yet — the news job runs every 15 minutes.</p>
        )}
      </div>
    </div>
  );
}
