import Link from 'next/link';
import { getTrendingNews, getTransferNews } from '@/lib/site/queries/news';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague, getLeagues } from '@/lib/site/queries/leagues';
import { getFollowingLeagues } from '@/lib/site/following';
import { resolveLeagueIds } from '@/lib/site/leagueFilter';
import { selectLeadStory } from '@/lib/site/leadStory';
import { selectMarqueeFixtures } from '@/lib/site/marqueeClubs';
import { NewsCard } from '@/components/NewsCard';
import { Hero } from '@/components/Hero';
import { Ticker, type PendingKickoff } from '@/components/Ticker';
import { TransfersRail } from '@/components/TransfersRail';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { groupFixturesByDay } from '@/lib/site/spine';
import type { LeagueRow } from '@/lib/site/rows';

// Landing-page-only feed sizes — deliberately small. This page is a
// trailer for /news and /transfers, not the full feed (that used to run
// far too long: a live-feedback finding, not a design preference). Enough
// headroom is fetched for `selectLeadStory`/slicing to have real candidates
// to choose from, without pulling in everything /news itself will show.
const LANDING_NEWS_FETCH = 8;   // lead story + up to 4 headline cards below it
const LANDING_HEADLINE_COUNT = 4;
const LANDING_TRANSFER_COUNT = 6;
// Enough upcoming fixtures that `selectMarqueeFixtures` almost always finds
// its 8 marquee matches without needing the soonest-remaining fallback —
// see lib/site/marqueeClubs.ts. Still just a page size on top of
// `getUpcoming`'s existing chronological scoping, not a data-layer change.
const LANDING_FIXTURES_FETCH = 60;
const SELECTED_FIXTURES_COUNT = 8;

// Reading the `touchline-following` cookie (lib/site/following.ts) opts this
// route into dynamic rendering the same way app/scores/page.tsx's
// `searchParams` read does — `revalidate` below is inert for the same
// reason documented there, kept as a statement of intent (a 5-minute cap,
// comfortably below the ingest cadence) rather than removed.
export const revalidate = 300;

/**
 * Narrows away the null-kickoff case so TypeScript enforces the invariant
 * at compile time — a league whose earliest scheduled kickoff is unknown
 * (no upcoming fixture at all) has nothing for the ticker's countdown mode
 * to show.
 */
function hasKickoff(entry: { league: LeagueRow; kickoffUtc: string | null }): entry is PendingKickoff {
  return entry.kickoffUtc !== null;
}

export default async function Home() {
  const now = new Date();
  const following = await getFollowingLeagues();
  const [news, transfers, live, upcoming, seasons, leagues] = await Promise.all([
    getTrendingNews(LANDING_NEWS_FETCH),
    getTransferNews(LANDING_TRANSFER_COUNT),
    getLiveAndRecent(now),
    getUpcoming(now, LANDING_FIXTURES_FETCH),
    getNextKickoffPerLeague(now),
    getLeagues(),
  ]);

  // The hero slot gets its own selection (spec: prefer an image, deprioritise
  // promo/meta titles, then recency) — the grid below stays purely
  // chronological, so `rest` is every fetched item minus whichever one led,
  // not simply `news.slice(1)` (the lead may not be `news[0]` any more).
  // Capped to LANDING_HEADLINE_COUNT: the landing page is a trailer for the
  // full feed at /news, not the feed itself.
  const lead = selectLeadStory(news);
  const rest = (lead ? news.filter((n) => n.id !== lead.id) : news).slice(0, LANDING_HEADLINE_COUNT);
  const pending = seasons.filter(hasKickoff);
  // Following supplies the ticker's default scope (spec: "the landing
  // ticker ... default to those competitions"). Following nothing behaves
  // exactly like today — every league shown, unfiltered.
  const followedIds = following.length > 0 ? new Set(resolveLeagueIds(leagues, following)) : null;
  const tickerLive = followedIds ? live.filter((f) => followedIds.has(f.league_id)) : live;
  const tickerPending = followedIds ? pending.filter((p) => followedIds.has(p.league.id)) : pending;

  // Editorial pick, not popularity data (there is none) — see
  // lib/site/marqueeClubs.ts. Falls back to the soonest remaining fixtures
  // if fewer than SELECTED_FIXTURES_COUNT involve a marquee club, so this
  // section is never thin or empty.
  const selectedFixtures = selectMarqueeFixtures(upcoming, SELECTED_FIXTURES_COUNT);
  const spineDays = groupFixturesByDay(selectedFixtures);

  return (
    <div className="space-y-10">
      <Ticker live={tickerLive} pending={tickerPending} leagues={leagues} now={now} />

      {lead ? <Hero item={lead} now={now} /> : (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No headlines yet — the news job runs every 15 minutes.
        </div>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          {/* "Selected fixtures", not "Top matches" or similar — an
              honest label for an editorial pick (lib/site/marqueeClubs.ts),
              not a data-derived ranking. /scores and /calendar keep showing
              every fixture, unfiltered. */}
          <h2 className="text-11 font-bold uppercase tracking-[0.14em] text-muted">Selected fixtures</h2>
          <Link href="/calendar" className="text-11 text-muted hover:text-text">Full calendar →</Link>
        </div>
        {/* Eager: this spine sits above the fold on a laptop viewport, so
            lazy-loading its crests shows a row of blank gaps that reads as a
            failed image load before they pop in. */}
        <MatchdaySpine days={spineDays} leagues={leagues} now={now} eagerCrests />
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-11 font-bold uppercase tracking-[0.14em] text-muted">Headlines</h2>
          <Link href="/news" className="text-11 text-muted hover:text-text">More →</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((n) => <NewsCard key={n.id} item={n} now={now} />)}
          {rest.length === 0 && <p className="text-sm text-muted">No further headlines yet.</p>}
        </div>
      </section>

      {transfers.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-11 font-bold uppercase tracking-[0.14em] text-muted">Transfers</h2>
            <Link href="/transfers" className="text-11 text-muted hover:text-text">More →</Link>
          </div>
          <TransfersRail items={transfers} leagues={leagues} now={now} />
        </section>
      )}

      <section className="rounded-xl border border-dashed border-border p-6">
        <h2 className="text-sm font-bold">Fantasy — coming soon</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Pick a squad from across the top five leagues, score points on real results, and run a
          league against your friends. In development.
        </p>
      </section>
    </div>
  );
}
