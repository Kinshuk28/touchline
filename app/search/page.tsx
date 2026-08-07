import Link from 'next/link';
import type { Metadata } from 'next';
import { searchClubs, searchPlayers } from '@/lib/site/queries/search';
import { getLeagues } from '@/lib/site/queries/leagues';
import { isSearchable, normalizeSearchQuery, sortByRelevance, MIN_QUERY_LENGTH } from '@/lib/site/searchQuery';
import { getCompetitionMeta } from '@/lib/site/competition';
import { BoardPanel } from '@/components/BoardPanel';
import { Crest } from '@/components/Crest';

/*
 * /search — clubs and players by name.
 *
 * A GET form with `?q=`, server-rendered, no client state: the same
 * mechanism `/scores` uses for `?leagues=` and the landing board for
 * `?table=`, which means a result page is a real URL you can share, reload
 * or open in a new tab.
 *
 * Scope is stated on the page rather than implied. This searches the two
 * things the database can match by name — the 110 stored clubs and every
 * ingested player. It does not search fixtures, tables or headlines, and
 * saying so is cheaper than a reader concluding the site simply couldn't
 * find their match.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Search — Touchline',
  description: 'Find a club or player across Europe\'s top five leagues.',
};

export default async function SearchPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = normalizeSearchQuery(q);
  const ready = isSearchable(query);

  const [clubs, players, leagues] = ready
    ? await Promise.all([searchClubs(query), searchPlayers(query), getLeagues()])
    : [[], [], await getLeagues()];

  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  // The database matched; this orders. Nothing here can introduce a result
  // the query didn't find.
  const rankedClubs = sortByRelevance(clubs, query, (c) => c.short_name ?? c.name);
  const rankedPlayers = sortByRelevance(players, query, (p) => p.name);
  const total = rankedClubs.length + rankedPlayers.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Search</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Clubs and players across the Premier League, La Liga, Serie A, the Bundesliga and Ligue 1.
          Fixtures, tables and headlines aren&rsquo;t searched — they have their own pages.
        </p>
      </div>

      {/* A plain GET form. No JavaScript, no debounce, no client state: the
          result page is the URL. */}
      <form action="/search" method="get" role="search" className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">Search clubs and players</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Arsenal, Bellingham, RMA…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-15 placeholder:text-muted"
        />
        <button
          type="submit"
          className="rounded-lg border border-text bg-surface-2 px-4 py-2 text-11 font-semibold uppercase tracking-wider"
        >
          Search
        </button>
      </form>

      {!ready ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          {query.length === 0
            ? 'Type a club or player name.'
            : `Enter at least ${MIN_QUERY_LENGTH} characters — one letter matches too much to be useful.`}
        </p>
      ) : total === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          Nothing matches &ldquo;{query}&rdquo;. Player records come from the squad and scorer feeds, so a
          player who has not appeared in either is not on file yet.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          {rankedClubs.length > 0 && (
            <BoardPanel order={0} label="Clubs" meta={`${rankedClubs.length}`}>
              <ul>
                {rankedClubs.map((club) => {
                  const league = club.league_id !== null ? leagueById.get(club.league_id) : undefined;
                  const comp = getCompetitionMeta(league?.fd_code ?? '');
                  return (
                    <li key={club.id} className="border-b border-border last:border-b-0">
                      <Link
                        href={`/team/${club.slug}`}
                        className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2"
                      >
                        <Crest team={club} size={24} />
                        <span className="min-w-0 flex-1 truncate text-15 font-medium">{club.name}</span>
                        {/* The competition as text, with its colour as
                            decoration on top — never the dot alone. A club
                            outside the current five says so rather than
                            showing a blank. */}
                        <span className="flex shrink-0 items-center gap-1.5 text-11 uppercase tracking-wider text-muted">
                          {league && <span className={`size-1.5 rounded-full ${comp.bgClass}`} aria-hidden="true" />}
                          {league ? league.name : 'Not in a top-five league'}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </BoardPanel>
          )}

          {rankedPlayers.length > 0 && (
            <BoardPanel order={1} label="Players" meta={`${rankedPlayers.length}`}>
              <ul>
                {rankedPlayers.map((player) => (
                  <li key={player.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/player/${player.slug}`}
                      className="flex items-baseline justify-between gap-3 px-3 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-15 font-medium">{player.name}</span>
                      {player.position && (
                        <span className="shrink-0 text-11 uppercase tracking-wider text-muted">{player.position}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </BoardPanel>
          )}
        </div>
      )}
    </div>
  );
}
