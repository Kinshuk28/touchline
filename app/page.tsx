import Link from 'next/link';
import { getTrendingNews, getTransferNews } from '@/lib/site/queries/news';
import { countUpcoming, getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague, getLeagues } from '@/lib/site/queries/leagues';
import { getStandings } from '@/lib/site/queries/standings';
import { getClubNames } from '@/lib/site/queries/teams';
import { getFantasySeason, isMissingTable } from '@/lib/site/queries/fantasy';
import { getFollowingLeagues } from '@/lib/site/following';
import { resolveLeagueIds } from '@/lib/site/leagueFilter';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { fixtureDateRange, fixturePanelHeading } from '@/lib/site/boardLabels';
import { isUnplayedSeason, seasonLabel } from '@/lib/site/standingsDisplay';
import { groupFixturesByDay } from '@/lib/site/spine';
import { getSession } from '@/lib/auth/session';
import { getSeasonScore, type NamedSeasonScore } from '@/lib/fantasy/squadStore';
import { BoardPanel } from '@/components/BoardPanel';
import { CompetitionTabs } from '@/components/CompetitionTabs';
import { FantasyTeaser } from '@/components/FantasyTeaser';
import { MyFantasyPanel } from '@/components/fantasy/MyFantasyPanel';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { MiniTable } from '@/components/MiniTable';
import { NewsRail } from '@/components/NewsRail';
import { Ticker, type PendingKickoff } from '@/components/Ticker';
import { TransfersRail } from '@/components/TransfersRail';
import type { LeagueRow } from '@/lib/site/rows';

/*
 * The landing page is a board, not an article
 * (docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md).
 *
 * What was here before was the generic content-site skeleton — header,
 * full-bleed hero image, section label, list, section label, card grid —
 * and that shape reads as templated however it is coloured. Two rounds of
 * palette work didn't fix it because composition was the problem.
 *
 * So: no hero, nothing full-bleed, three asymmetric columns of real data.
 * Fixtures widest because they are the most information, the table and
 * transfers in the middle, news narrowest — someone checking in for ten
 * seconds sees the weekend, the table and the headlines at once, without
 * scrolling. The acceptance test is that everything meaningful fits above
 * the fold at 1440x900.
 */

// Fetch sizes. News is fetched well above what the rail shows so
// `orderByRelevance` has real candidates to promote — with a global feed
// and a top-five-leagues site, the relevant items are frequently not the
// newest ones (see lib/site/newsRelevance.ts).
const NEWS_FETCH = 24;
const NEWS_RAIL_COUNT = 8;
const TRANSFER_FETCH = 18;
const TRANSFER_RAIL_COUNT = 6;
// The next 14 fixtures, in kickoff order, across every competition.
//
// This panel used to run `selectMarqueeFixtures` — an editorial pick of 22
// well-known clubs — over a 60-fixture window. That actively hid football:
// an opening weekend whose matches happen to be Alavés v Getafe, Espanyol v
// Levante and Celta v Osasuna showed none of them, and skipped days ahead to
// the next fixture involving a big club. A board that says "Next up" and
// then isn't is worse than no board, so the filter is gone and the module
// with it (lib/site/marqueeClubs.ts, deleted): what is next is what shows.
//
// 14 rows because at 14 the fixture column ends level with the
// table-plus-transfers column beside it, and the whole board still clears
// the fold at 1440x900. The panel says how many of the total that is and
// links to the rest, rather than implying it is everything.
const BOARD_FIXTURE_COUNT = 14;
const TABLE_ROW_COUNT = 6;

// Reading the `touchline-following` cookie (lib/site/following.ts) and
// `searchParams` both opt this route into dynamic rendering, the same way
// app/scores/page.tsx does — `revalidate` is inert for that reason, kept as
// a statement of intent (a 5-minute cap, comfortably below the ingest
// cadence) rather than removed.
export const revalidate = 300;

function hasKickoff(entry: { league: LeagueRow; kickoffUtc: string | null }): entry is PendingKickoff {
  return entry.kickoffUtc !== null;
}

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ table?: string }> }) {
  const now = new Date();
  const { table } = await searchParams;
  const following = await getFollowingLeagues();
  const session = await getSession();

  const [news, transfers, live, upcoming, upcomingTotal, seasons, leagues, clubNames, mySeasonScore] = await Promise.all([
    getTrendingNews(NEWS_FETCH),
    getTransferNews(TRANSFER_FETCH),
    getLiveAndRecent(now),
    getUpcoming(now, BOARD_FIXTURE_COUNT),
    countUpcoming(now),
    getNextKickoffPerLeague(now),
    getLeagues(),
    getClubNames(),
    session ? getMySeasonScoreSafely(session.accessToken, session.userId) : Promise.resolve(null),
  ]);

  // A transfer story is also, honestly, "the latest news" — it has no
  // separate identity in `news_items`, just a `transfer` tag alongside
  // whatever else is stored. Fetched independently for two different panels
  // on the *same* page, the newest transfer stories routinely land in both:
  // the Transfers rail by construction, and the Latest rail because they are
  // also simply recent. Excluding anything already shown in Transfers is
  // page-level, not query-level, on purpose — `getTrendingNews` is also used
  // on /news and /team/[slug], neither of which has a competing Transfers
  // panel to duplicate against, so the query itself has no reason to exclude
  // transfer stories.
  const transferIds = new Set(transfers.map((t) => t.id));
  const nonTransferNews = news.filter((n) => !transferIds.has(n.id));

  // Relevance, the spec's worst-content-bug fix: the feeds are global
  // football, this site is the top five leagues. Ordering, not filtering —
  // when nothing in the feed names a stored club the rail still fills, with
  // the newest items, rather than going empty.
  const clubIndex = buildClubIndex(clubNames);
  const railNews = orderByRelevance(nonTransferNews, clubIndex, NEWS_RAIL_COUNT);
  const railTransfers = orderByRelevance(transfers, clubIndex, TRANSFER_RAIL_COUNT);

  const pending = seasons.filter(hasKickoff);
  // Following supplies the ticker's default scope. Following nothing
  // behaves exactly as before — every league, unfiltered.
  const followedIds = following.length > 0 ? new Set(resolveLeagueIds(leagues, following)) : null;
  const tickerLive = followedIds ? live.filter((f) => followedIds.has(f.league_id)) : live;
  const tickerPending = followedIds ? pending.filter((p) => followedIds.has(p.league.id)) : pending;

  const spineDays = groupFixturesByDay(upcoming);
  const fixtureHeading = fixturePanelHeading(spineDays[0]?.date ?? null, now);
  const fixtureRange = fixtureDateRange(spineDays);

  // The table panel. `?table=` picks the competition; an unrecognised or
  // absent code falls back to the first league in presentation order rather
  // than rendering nothing — the same "unknown code matches nothing, so
  // show the default" shape `/scores` uses, applied to a single-select.
  const selectedLeague = leagues.find((l) => l.fd_code === table) ?? leagues[0] ?? null;
  // Two seasons fetched, one shown: the 2026-27 rows exist but are all
  // zeros until the season kicks off on 2026-08-16, and a table of zeros is
  // not a table. Preferring the completed season while that's true is the
  // same rule /tables applies, decided from the rows themselves
  // (`isUnplayedSeason`) rather than from the calendar.
  const [currentRows, lastRows] = selectedLeague
    ? await Promise.all([
      getStandings(selectedLeague.id, selectedLeague.current_season),
      getStandings(selectedLeague.id, selectedLeague.current_season - 1),
    ])
    : [[], []];
  const showingLast = currentRows.length === 0 || isUnplayedSeason(currentRows);
  const tableRows = showingLast ? lastRows : currentRows;

  return (
    <div className="space-y-3">
      <Ticker live={tickerLive} pending={tickerPending} leagues={leagues} now={now} />

      {/*
        Asymmetric by design, not three equal columns: 1.6 / 1 / 0.9 of the
        1280px shell. Two columns at tablet (fixtures | table+transfers,
        news full width beneath), one at mobile. DOM order is fixtures ->
        table -> transfers -> news at every width, so the reading order the
        spec asks for holds without any grid-order trickery — the middle
        column is a real wrapper element rather than two independently
        placed grid children.
      */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start">
        <BoardPanel
          order={0}
          label={fixtureHeading}
          meta={
            // Range plus how much of the coming week this is. A summary
            // panel that doesn't say it is a summary is how the previous
            // version got away with hiding two thirds of a matchday — and
            // the count is windowed to a week because the unbounded one
            // ("14 of 1752", every fixture of five full seasons) reads as a
            // far bigger omission than the board is actually making.
            fixtureRange
              ? `${fixtureRange}${
                upcomingTotal > upcoming.length ? ` · ${upcoming.length} of ${upcomingTotal} this week` : ''
              }`
              : undefined
          }
          action={<Link href="/calendar" className="group/link inline-flex items-center gap-1 hover:text-text">All fixtures <span className="transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true">→</span></Link>}
        >
          {/* Eager crests: this spine is the board's largest element and
              sits above the fold, so lazy-loading leaves a column of blank
              gaps that reads as failed images. */}
          <MatchdaySpine
            days={spineDays}
            leagues={leagues}
            now={now}
            eagerCrests
            variant="compact"
            chromeless
          />
        </BoardPanel>

        <div className="space-y-3">
          {selectedLeague && (
            <BoardPanel
              order={1}
              label="Table"
              action={<Link href="/tables" className="group/link inline-flex items-center gap-1 hover:text-text">All tables <span className="transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true">→</span></Link>}
            >
              <CompetitionTabs
                leagues={leagues}
                selected={selectedLeague}
                ariaLabel="Choose a competition table"
                hrefFor={(league) => (league === null || league.fd_code === leagues[0]?.fd_code ? '/' : `/?table=${league.fd_code}`)}
              />
              {/* The competition's full name in text, next to the season
                  actually being shown — "2025-26 final" is a claim about
                  which season this is, so it is stated, never implied. */}
              <p className="border-b border-border px-3 py-1 text-11 text-muted">
                {selectedLeague.name}
                {tableRows.length > 0 && (
                  <> · {seasonLabel(tableRows[0]?.season ?? 0)}{showingLast ? ' final' : ''}</>
                )}
              </p>
              <MiniTable league={selectedLeague} rows={tableRows} limit={TABLE_ROW_COUNT} />
            </BoardPanel>
          )}

          {railTransfers.length > 0 && (
            <BoardPanel
              order={2}
              label="Transfers"
              action={<Link href="/transfers" className="group/link inline-flex items-center gap-1 hover:text-text">More <span className="transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true">→</span></Link>}
            >
              <TransfersRail items={railTransfers} leagues={leagues} now={now} chromeless stacked />
            </BoardPanel>
          )}
        </div>

        <div className="md:col-span-2 lg:col-span-1">
          <BoardPanel
            order={3}
            label="Latest"
            action={<Link href="/news" className="group/link inline-flex items-center gap-1 hover:text-text">More <span className="transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true">→</span></Link>}
          >
            <NewsRail items={railNews} now={now} />
          </BoardPanel>
        </div>
      </div>

      {/* A manager who already plays sees their own season here — real data,
          not the pitch. Everyone else sees the one openly promotional block
          on the page (components/FantasyTeaser.tsx), the only place
          illustrative motion can honestly sit, since everything above it is
          stored data. Either way this replaces the one-line strip this used
          to be: a flagship feature deserves more than a footnote. */}
      {mySeasonScore ? <MyFantasyPanel score={mySeasonScore} /> : <FantasyTeaser />}
    </div>
  );
}

/**
 * `getSeasonScore` needs the fantasy tables (0006-0008) and fails outright
 * without them — expected between this code deploying and the project owner
 * applying those migrations by hand, and no reason for the whole landing
 * page to 500 over it. Falling back to the promotional teaser in that case
 * is exactly what a signed-in-but-not-set-up visitor should see.
 */
async function getMySeasonScoreSafely(accessToken: string, userId: string): Promise<NamedSeasonScore | null> {
  try {
    const season = await getFantasySeason();
    if (season === null) return null;
    return await getSeasonScore(accessToken, userId, season);
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) return null;
    throw err;
  }
}
