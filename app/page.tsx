import Link from 'next/link';
import { getTrendingNews, getTransferNews } from '@/lib/site/queries/news';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague, getLeagues } from '@/lib/site/queries/leagues';
import { getFollowingLeagues } from '@/lib/site/following';
import { resolveLeagueIds } from '@/lib/site/leagueFilter';
import { NewsCard } from '@/components/NewsCard';
import { Hero } from '@/components/Hero';
import { Ticker, type PendingKickoff } from '@/components/Ticker';
import { TransfersRail } from '@/components/TransfersRail';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { groupFixturesByDay } from '@/lib/site/spine';
import type { LeagueRow } from '@/lib/site/rows';

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
    getTrendingNews(17),
    getTransferNews(10),
    getLiveAndRecent(now),
    getUpcoming(now, 20),
    getNextKickoffPerLeague(now),
    getLeagues(),
  ]);

  const [lead, ...rest] = news;
  const pending = seasons.filter(hasKickoff);
  // Following supplies the ticker's default scope (spec: "the landing
  // ticker ... default to those competitions"). Following nothing behaves
  // exactly like today — every league shown, unfiltered.
  const followedIds = following.length > 0 ? new Set(resolveLeagueIds(leagues, following)) : null;
  const tickerLive = followedIds ? live.filter((f) => followedIds.has(f.league_id)) : live;
  const tickerPending = followedIds ? pending.filter((p) => followedIds.has(p.league.id)) : pending;

  const spineDays = groupFixturesByDay(upcoming);

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
          <h2 className="text-11 font-bold uppercase tracking-[0.14em] text-muted">Next fixtures</h2>
          <Link href="/calendar" className="text-11 text-muted hover:text-text">Full calendar →</Link>
        </div>
        <MatchdaySpine days={spineDays} leagues={leagues} now={now} />
      </section>

      <section>
        <h2 className="mb-2 text-11 font-bold uppercase tracking-[0.14em] text-muted">Headlines</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((n) => <NewsCard key={n.id} item={n} now={now} />)}
          {rest.length === 0 && <p className="text-sm text-muted">No further headlines yet.</p>}
        </div>
      </section>

      {transfers.length > 0 && (
        <section>
          <h2 className="mb-2 text-11 font-bold uppercase tracking-[0.14em] text-muted">Transfers</h2>
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
