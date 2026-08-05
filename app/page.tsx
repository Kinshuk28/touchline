import Link from 'next/link';
import { getTrendingNews, getTransferNews } from '@/lib/site/queries/news';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague, getLeagues } from '@/lib/site/queries/leagues';
import { getStandings } from '@/lib/site/queries/standings';
import { getClubNames } from '@/lib/site/queries/teams';
import { getFollowingLeagues } from '@/lib/site/following';
import { resolveLeagueIds } from '@/lib/site/leagueFilter';
import { selectMarqueeFixtures } from '@/lib/site/marqueeClubs';
import { buildClubIndex, orderByRelevance } from '@/lib/site/newsRelevance';
import { fixtureDateRange, fixturePanelHeading } from '@/lib/site/boardLabels';
import { getCompetitionMeta } from '@/lib/site/competition';
import { isUnplayedSeason, seasonLabel } from '@/lib/site/standingsDisplay';
import { groupFixturesByDay } from '@/lib/site/spine';
import { BoardPanel } from '@/components/BoardPanel';
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
// Enough upcoming fixtures for `selectMarqueeFixtures` to find its board's
// worth across five competitions without falling back to soonest-remaining.
// 14 rows, not the spec sketch's 12: at 14 the fixture column ends level
// with the table-plus-transfers column beside it, and a board whose tallest
// column is 180px longer than its neighbour reads as an unfinished grid.
// Still one screen's worth — measured at 1440x900, the whole board clears
// the fold.
const FIXTURES_FETCH = 60;
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

/**
 * The table panel's competition tabs. `?table=PD` in the query string, same
 * mechanism as `/scores`' `?leagues=` and `/tables`' `?season=` — a refresh
 * keeps your choice, and the whole board stays server-rendered with no
 * client state.
 *
 * Labels are the competition codes because five full league names do not
 * fit across a 340px column, and a wrapped two-line tab row would cost the
 * board more than the abbreviation costs a reader. The code is text (not
 * colour), the colour dot is decoration on top of it, the selected
 * competition's full name is printed in the line directly beneath these
 * tabs, and every tab carries its full name for assistive tech — so the
 * abbreviation is never the only thing carrying the meaning.
 */
function TableTabs({ leagues, selected }: { leagues: LeagueRow[]; selected: LeagueRow }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5" aria-label="Choose a competition table">
      {leagues.map((league) => {
        const comp = getCompetitionMeta(league.fd_code);
        const active = league.id === selected.id;
        return (
          <Link
            key={league.id}
            href={league.fd_code === leagues[0]?.fd_code ? '/' : `/?table=${league.fd_code}`}
            aria-current={active ? 'true' : undefined}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-11 font-semibold uppercase tracking-wider ${
              active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            <span className={`size-1.5 rounded-full ${comp.bgClass}`} aria-hidden="true" />
            {league.fd_code}
            <span className="sr-only"> — {league.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ table?: string }> }) {
  const now = new Date();
  const { table } = await searchParams;
  const following = await getFollowingLeagues();

  const [news, transfers, live, upcoming, seasons, leagues, clubNames] = await Promise.all([
    getTrendingNews(NEWS_FETCH),
    getTransferNews(TRANSFER_FETCH),
    getLiveAndRecent(now),
    getUpcoming(now, FIXTURES_FETCH),
    getNextKickoffPerLeague(now),
    getLeagues(),
    getClubNames(),
  ]);

  // Relevance, the spec's worst-content-bug fix: the feeds are global
  // football, this site is the top five leagues. Ordering, not filtering —
  // when nothing in the feed names a stored club the rail still fills, with
  // the newest items, rather than going empty.
  const clubIndex = buildClubIndex(clubNames);
  const railNews = orderByRelevance(news, clubIndex, NEWS_RAIL_COUNT);
  const railTransfers = orderByRelevance(transfers, clubIndex, TRANSFER_RAIL_COUNT);

  const pending = seasons.filter(hasKickoff);
  // Following supplies the ticker's default scope. Following nothing
  // behaves exactly as before — every league, unfiltered.
  const followedIds = following.length > 0 ? new Set(resolveLeagueIds(leagues, following)) : null;
  const tickerLive = followedIds ? live.filter((f) => followedIds.has(f.league_id)) : live;
  const tickerPending = followedIds ? pending.filter((p) => followedIds.has(p.league.id)) : pending;

  const boardFixtures = selectMarqueeFixtures(upcoming, BOARD_FIXTURE_COUNT);
  const spineDays = groupFixturesByDay(boardFixtures);
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
          label={fixtureHeading}
          meta={fixtureRange ?? undefined}
          action={<Link href="/calendar" className="hover:text-text">All fixtures →</Link>}
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
              label="Table"
              action={<Link href="/tables" className="hover:text-text">All tables →</Link>}
            >
              <TableTabs leagues={leagues} selected={selectedLeague} />
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
              label="Transfers"
              action={<Link href="/transfers" className="hover:text-text">More →</Link>}
            >
              <TransfersRail items={railTransfers} leagues={leagues} now={now} chromeless stacked />
            </BoardPanel>
          )}
        </div>

        <div className="md:col-span-2 lg:col-span-1">
          <BoardPanel
            label="Latest"
            action={<Link href="/news" className="hover:text-text">More →</Link>}
          >
            <NewsRail items={railNews} now={now} />
          </BoardPanel>
        </div>
      </div>

      {/* Kept from the old page, reduced to the one line it was always
          worth: the board's whole argument is density, and a dashed
          placeholder box the height of four fixture rows argues the
          opposite. */}
      <p className="rounded-xl border border-dashed border-border px-3 py-2 text-11 text-muted">
        <span className="font-semibold uppercase tracking-wider text-text">Fantasy</span> — pick a squad from
        across the top five leagues, score points on real results, run a league against your friends. In
        development.
      </p>
    </div>
  );
}
