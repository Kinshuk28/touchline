import Link from 'next/link';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getStandings } from '@/lib/site/queries/standings';
import { StandingsTable } from '@/components/StandingsTable';
import { CompetitionTabs } from '@/components/CompetitionTabs';
import { seasonLabel } from '@/lib/site/standingsDisplay';
import type { LeagueRow } from '@/lib/site/rows';

// Reading `searchParams` forces dynamic rendering (same reasoning as
// app/scores/page.tsx), so this `revalidate` caps how stale a dynamically
// rendered response can be rather than driving ISR directly.
export const revalidate = 60;

/**
 * Season toggle, `?season=current` vs the default — the same query-param
 * mechanism `/scores`'s `?leagues=` uses, so a refresh preserves the choice
 * (spec: "consistent with `?leagues=`"). Two links, not a form or client
 * toggle: the whole page is server-rendered from this one param.
 */
function SeasonToggle({ lastSeason, currentSeason, showingCurrent, hrefFor }: {
  lastSeason: number; currentSeason: number; showingCurrent: boolean;
  hrefFor: (overrides: { season?: string }) => string;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Select season">
      <Link
        href={hrefFor({ season: '' })}
        aria-current={!showingCurrent ? 'true' : undefined}
        className={`rounded-full border px-3 py-1.5 text-11 font-semibold uppercase tracking-wider ${
          !showingCurrent ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
        }`}
      >
        {seasonLabel(lastSeason)} final
      </Link>
      <Link
        href={hrefFor({ season: 'current' })}
        aria-current={showingCurrent ? 'true' : undefined}
        className={`rounded-full border px-3 py-1.5 text-11 font-semibold uppercase tracking-wider ${
          showingCurrent ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
        }`}
      >
        {seasonLabel(currentSeason)} — not yet played
      </Link>
    </nav>
  );
}

export default async function TablesPage({
  searchParams,
}: { searchParams: Promise<{ season?: string; league?: string }> }) {
  const { season, league: leagueParam } = await searchParams;
  const showingCurrent = season === 'current';

  const leagues = await getLeagues();
  // Every league's `current_season` is the same live campaign (2026-27,
  // starting 2026-08-16) — falling back to the first league's value keeps
  // this correct even if `leagues` is somehow empty, without a second query.
  const currentSeason = leagues[0]?.current_season ?? new Date().getUTCFullYear();
  const lastSeason = currentSeason - 1;
  const selectedSeason = showingCurrent ? currentSeason : lastSeason;

  // `?league=` picks one competition's table; `?league=all` is the explicit
  // opt-in back to the old "every table, stacked" view for anyone who wants
  // it. Absent or unrecognised defaults to the first league rather than
  // "all" — five full standings tables, each with its own form strip and
  // relegation hairlines, is a lot of scrolling to reach the one table
  // most visits actually want, and defaulting to "show everything" is
  // exactly the shape that complaint was about.
  const showingAll = leagueParam === 'all';
  const selectedLeague = showingAll ? null : leagues.find((l) => l.fd_code === leagueParam) ?? leagues[0] ?? null;
  const leaguesToShow = showingAll ? leagues : selectedLeague ? [selectedLeague] : [];

  const tables = await Promise.all(
    leaguesToShow.map(async (league) => ({ league, rows: await getStandings(league.id, selectedSeason) })),
  );

  // Both tabs share one query string: switching the league keeps the season
  // choice, and vice versa — a `Set`-and-clear helper so neither control has
  // to know the other's param name, just that both live on the same URL.
  // An override of `''` clears that param explicitly (`??` only falls back
  // on `undefined`, not an empty string), which is what lets the season
  // toggle's "last season" link drop `?season=current` rather than getting
  // stuck reapplying whatever the URL already had.
  function hrefFor(overrides: { league?: string; season?: string }): string {
    const params = new URLSearchParams();
    const leagueVal = overrides.league ?? leagueParam ?? '';
    const seasonVal = overrides.season ?? season ?? '';
    if (leagueVal) params.set('league', leagueVal);
    if (seasonVal) params.set('season', seasonVal);
    const qs = params.toString();
    return qs ? `/tables?${qs}` : '/tables';
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Tables</h1>
        <SeasonToggle
          lastSeason={lastSeason}
          currentSeason={currentSeason}
          showingCurrent={showingCurrent}
          hrefFor={hrefFor}
        />
      </div>

      <CompetitionTabs
        leagues={leagues}
        selected={selectedLeague}
        showAll
        ariaLabel="Choose a league table"
        hrefFor={(league: LeagueRow | null) => hrefFor({ league: league === null ? 'all' : league.fd_code })}
      />

      <div className="space-y-8">
        {tables.map(({ league, rows }) => (
          <StandingsTable key={league.id} league={league} rows={rows} />
        ))}
        {tables.length === 0 && (
          <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">No tables available yet.</p>
        )}
      </div>
    </div>
  );
}
