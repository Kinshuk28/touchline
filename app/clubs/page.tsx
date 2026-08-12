import { getLeagues } from '@/lib/site/queries/leagues';
import { getTeams } from '@/lib/site/queries/teams';
import { getCompetitionMeta } from '@/lib/site/competition';
import { CompetitionTabs } from '@/components/CompetitionTabs';
import { ClubCard } from '@/components/ClubCard';
import type { ClubRow, LeagueRow } from '@/lib/site/rows';

// Reading `searchParams` forces dynamic rendering (same reasoning as
// app/tables/page.tsx) — the season/league toggle these pages share is
// exactly why /tables already pays this cost, and this route is now the
// same shape.
export const revalidate = 60;

/**
 * A club counts as historical — no longer in a current top-five
 * competition — only when *none* of `venue`, `founded` and `club_colors`
 * are on file. That's not an arbitrary proxy for competition membership:
 * `scripts/backfill.ts`'s phase 3 ("historical clubs", clubs recovered only
 * from a past season's standings because they've dropped out of every
 * competition the free tier covers) writes exactly those three fields as
 * `null` together, in the same object literal that gives the club its
 * identity; phase 2 ("current clubs", pulled from a competition's live
 * teams listing) writes real values for all three. Checking that *all
 * three* are absent, rather than trusting a single field, means a current
 * club is never misclassified as historical just because one field
 * happens to be individually null from an upstream gap — only the
 * genuinely-historical rows clear every one of the three.
 *
 * See `ClubRow`'s doc comment (lib/site/rows.ts) for the same invariant
 * documented alongside the type.
 */
function isHistoricalClub(club: ClubRow): boolean {
  return club.venue === null && club.founded === null && club.club_colors === null;
}

function CompetitionGroup({
  league, clubs, eager,
}: { league: LeagueRow; clubs: ClubRow[]; eager: boolean }) {
  const comp = getCompetitionMeta(league.fd_code);
  return (
    <section>
      <div className={`flex items-center gap-3 border-b-2 px-1 pb-2 ${comp.borderClass}`}>
        <span className={`h-4 w-1 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
        <h2 className="font-display text-15 font-bold uppercase tracking-wide">{league.name}</h2>
        <span className="ml-auto font-mono text-11 text-muted">
          {clubs.length} club{clubs.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {/* Eager only for the first competition group's first row (above
            the fold at 1280x800) — every other crest lazy-loads, same rule
            `eager` follows everywhere else it's threaded through (see
            components/Crest.tsx). */}
        {clubs.map((club, i) => <ClubCard key={club.id} club={club} eager={eager && i < 4} />)}
      </div>
    </section>
  );
}

/**
 * The 14 of 110 clubs no longer in a current top-five competition, in their
 * own clearly-labelled group rather than silently excluded — the spec asks
 * for "honest handling" of these rows, and a club that finished last season
 * in, say, La Liga but was relegated is still real data worth showing
 * (these tables retain it for exactly that reason), just not data that
 * belongs mixed into a *current* competition's group. No competition
 * colour on the header: these clubs aren't currently tied to one, and
 * reusing their last league's colour here would misrepresent this season.
 *
 * Only ever shown in the "All" view — these clubs have no `league_id`, so
 * there is no single-league tab they could belong to.
 */
function HistoricalGroup({ clubs }: { clubs: ClubRow[] }) {
  if (clubs.length === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-3 border-b-2 border-border px-1 pb-2">
        <span className="h-4 w-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
        <h2 className="font-display text-15 font-bold uppercase tracking-wide text-muted">
          Not in a top-five league this season
        </h2>
        <span className="ml-auto font-mono text-11 text-muted">
          {clubs.length} club{clubs.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-2 px-1 text-13 text-muted">
        Relegated, or otherwise no longer in a competition this build covers — retained here for
        last season's tables. No venue, founding year or kit colours on file for these clubs.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {clubs.map((club) => <ClubCard key={club.id} club={club} />)}
      </div>
    </section>
  );
}

export default async function ClubsPage({
  searchParams,
}: { searchParams: Promise<{ league?: string }> }) {
  const { league: leagueParam } = await searchParams;
  const [leagues, teams] = await Promise.all([getLeagues(), getTeams()]);

  const historical = teams.filter(isHistoricalClub);
  const current = teams.filter((c) => !isHistoricalClub(c));

  // Same "one league at a time by default, `all` opts back into the full
  // scroll" shape as /tables — 110 cards across five sections plus the
  // historical group was the other page this complaint named directly.
  const showingAll = leagueParam === 'all';
  const selectedLeague = showingAll ? null : leagues.find((l) => l.fd_code === leagueParam) ?? leagues[0] ?? null;
  const leaguesToShow = showingAll ? leagues : selectedLeague ? [selectedLeague] : [];

  const groups = leaguesToShow
    .map((league) => ({ league, clubs: current.filter((c) => c.league_id === league.id) }))
    .filter((g) => g.clubs.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Clubs</h1>
        <p className="mt-1 text-sm text-muted">
          {teams.length} clubs across Europe&rsquo;s top five leagues.
        </p>
      </div>

      <CompetitionTabs
        leagues={leagues}
        selected={selectedLeague}
        showAll
        ariaLabel="Choose a league"
        hrefFor={(league) => (league === null ? '/clubs?league=all' : `/clubs?league=${league.fd_code}`)}
      />

      {groups.length === 0 && (!showingAll || historical.length === 0) && (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">No clubs on file yet.</p>
      )}

      {groups.map((g, i) => (
        <CompetitionGroup key={g.league.id} league={g.league} clubs={g.clubs} eager={i === 0} />
      ))}

      {showingAll && <HistoricalGroup clubs={historical} />}
    </div>
  );
}
