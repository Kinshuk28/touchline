import Link from 'next/link';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getStandings } from '@/lib/site/queries/standings';
import { StandingsTable } from '@/components/StandingsTable';
import { seasonLabel } from '@/lib/site/standingsDisplay';

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
function SeasonToggle({ lastSeason, currentSeason, showingCurrent }: {
  lastSeason: number; currentSeason: number; showingCurrent: boolean;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Select season">
      <Link
        href="/tables"
        aria-current={!showingCurrent ? 'true' : undefined}
        className={`rounded-full border px-3 py-1 text-11 font-semibold uppercase tracking-wider ${
          !showingCurrent ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
        }`}
      >
        {seasonLabel(lastSeason)} final
      </Link>
      <Link
        href="/tables?season=current"
        aria-current={showingCurrent ? 'true' : undefined}
        className={`rounded-full border px-3 py-1 text-11 font-semibold uppercase tracking-wider ${
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
}: { searchParams: Promise<{ season?: string }> }) {
  const { season } = await searchParams;
  const showingCurrent = season === 'current';

  const leagues = await getLeagues();
  // Every league's `current_season` is the same live campaign (2026-27,
  // starting 2026-08-16) — falling back to the first league's value keeps
  // this correct even if `leagues` is somehow empty, without a second query.
  const currentSeason = leagues[0]?.current_season ?? new Date().getUTCFullYear();
  const lastSeason = currentSeason - 1;
  const selectedSeason = showingCurrent ? currentSeason : lastSeason;

  const tables = await Promise.all(
    leagues.map(async (league) => ({ league, rows: await getStandings(league.id, selectedSeason) })),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Tables</h1>
        <SeasonToggle lastSeason={lastSeason} currentSeason={currentSeason} showingCurrent={showingCurrent} />
      </div>

      <div className="space-y-8">
        {tables.map(({ league, rows }) => (
          <StandingsTable key={league.id} league={league} rows={rows} />
        ))}
      </div>
    </div>
  );
}
