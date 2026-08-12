import { getTrendingNews } from '@/lib/site/queries/news';
import { getClubNames } from '@/lib/site/queries/teams';
import { getLeagues } from '@/lib/site/queries/leagues';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { NewsCard } from '@/components/NewsCard';
import { LeagueFilter } from '@/components/LeagueFilter';

// `searchParams` (the league filter) forces dynamic rendering, same
// reasoning as app/scores/page.tsx — this route was ISR-eligible before it
// had a filter to read.
export const revalidate = 300;

// Capped, not paginated (spec: "paginated or capped at a sensible number").
// A football aggregator's feed churns fast enough — ingestion runs every 15
// minutes — that a "page 2" link would mostly point at stories that are
// already stale; one generous cap over a single scroll's worth is simpler
// and doesn't need any new UI for page controls.
const NEWS_FEED_LIMIT = 60;

export default async function NewsPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  const selected = parseLeagueCodes(raw);
  const now = new Date();
  const leagues = await getLeagues();
  // Resolved up front, same reason /scores does: an unrecognised code must
  // resolve to "match nothing", never silently widen back to "everything".
  const leagueIds = selected.length > 0 ? resolveLeagueIds(leagues, selected) : undefined;

  const [feed, clubNames] = await Promise.all([
    getTrendingNews(NEWS_FEED_LIMIT, leagueIds),
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">News</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/news" />
      </div>
      {/* The full feed, so it keeps components/NewsCard.tsx — image-led at
          16:9 with a type-only fallback for the items that have no stored
          image (the Guardian stores none at all; that's expected, not a gap
          to fill). The landing page's own rail is a different, much denser
          component (components/NewsRail.tsx) precisely because eight of
          these cards would be 1800px of column. Club-relevant stories
          first, newest-first within that.

          The top story runs `lead`: a wider image at a higher-resolution
          CDN rendition (NewsCard's own `LEAD_IMAGE_WIDTH`) in a
          `sm:col-span-2` cell — half the row from `lg:` up, the full row
          below it — plus its summary underneath the headline, which no
          other card in the grid shows. One lead per page load, not per
          row: a grid where every third card were double-width would read
          as a mistake, not a hierarchy. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {news.map((n, i) => (
          <NewsCard key={n.id} item={n} now={now} lead={i === 0} className={i === 0 ? 'sm:col-span-2' : ''} />
        ))}
        {news.length === 0 && (
          <p className="text-sm text-muted">
            {/* `leagueIds !== undefined` means a filter is active at all —
                not `leagueIds.length === 0`, which only covers unrecognised
                codes. A real, resolved league (Ligue 1, say) can easily have
                no story in the newest LIMIT rows on its own; that's still a
                filtered-empty result, not the site having no news, and
                telling a reader "the job runs every 15 minutes" for it
                blames ingestion for what the filter actually did. */}
            {leagueIds !== undefined
              ? 'No headlines for that selection yet.'
              : 'No headlines yet — the news job runs every 15 minutes.'}
          </p>
        )}
      </div>
    </div>
  );
}
