import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTeamBySlug } from '@/lib/site/queries/teams';
import { getSquad } from '@/lib/site/queries/players';
import { getFixturesForTeam } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getStandings } from '@/lib/site/queries/standings';
import { getTrendingNews } from '@/lib/site/queries/news';
import { buildClubIndex, orderByRelevance, isRelevantHeadline } from '@/lib/site/newsRelevance';
import { splitTeamFixtures, teamRecord } from '@/lib/site/teamPage';
import { groupSquadByPosition } from '@/lib/site/squad';
import { getCompetitionMeta } from '@/lib/site/competition';
import { clubBarGradient } from '@/lib/site/clubColors';
import { groupFixturesByDay } from '@/lib/site/spine';
import { formatGoalDifference, isUnplayedSeason, seasonLabel, sortStandingsForDisplay } from '@/lib/site/standingsDisplay';
import { BoardPanel } from '@/components/BoardPanel';
import { Crest } from '@/components/Crest';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { NewsRail } from '@/components/NewsRail';

/*
 * /team/[slug] — the route the whole site has been pointing at without
 * having: every crest, every club name in a fixture row and every card on
 * /clubs had nowhere to go, and /clubs deliberately rendered non-links to
 * avoid shipping dead ends.
 *
 * One club, four panels: what is next, what just happened, where they sit
 * in the table, and who is in the squad — plus headlines that name them.
 * Every panel is drawn from stored data and omits itself when there is
 * nothing to show, rather than rendering an empty frame.
 */

// Well below the ingest cadence, same as every other read-only route.
export const revalidate = 300;

const UPCOMING_COUNT = 8;
const RESULTS_COUNT = 6;
const NEWS_FETCH = 60;
const CLUB_NEWS_COUNT = 6;

async function loadTeam(slug: string) {
  const team = await getTeamBySlug(slug);
  if (!team) notFound();
  return team;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: 'Club not found — Touchline' };
  return {
    title: `${team.name} — fixtures, results, squad — Touchline`,
    description: `Fixtures, results, league position and squad for ${team.name}.`,
  };
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const now = new Date();
  const team = await loadTeam(slug);

  const [fixtures, squad, leagues, news] = await Promise.all([
    getFixturesForTeam(team.id),
    getSquad(team.id),
    getLeagues(),
    getTrendingNews(NEWS_FETCH),
  ]);

  const league = team.league_id !== null ? leagues.find((l) => l.id === team.league_id) ?? null : null;
  const comp = getCompetitionMeta(league?.fd_code ?? '');

  // The club's own table row. Preferring the current season while it has
  // real results and falling back to last season's final table otherwise is
  // the same rule /tables and the landing board apply — decided from the
  // rows, never from the calendar.
  const [currentRows, lastRows] = league
    ? await Promise.all([
      getStandings(league.id, league.current_season),
      getStandings(league.id, league.current_season - 1),
    ])
    : [[], []];
  const usingLast = currentRows.length === 0 || isUnplayedSeason(currentRows);
  const tableRows = usingLast ? lastRows : currentRows;
  const sorted = sortStandingsForDisplay(tableRows);
  const position = sorted.findIndex((r) => r.team_id === team.id);
  const standing = position >= 0 ? sorted[position] : undefined;

  const { results, upcoming } = splitTeamFixtures(fixtures, now, {
    results: RESULTS_COUNT,
    upcoming: UPCOMING_COUNT,
  });
  const record = teamRecord(fixtures, team.id);
  const squadGroups = groupSquadByPosition(squad);

  // Headlines that name this club, by the same word-boundary matcher the
  // landing rails use — built here from one club rather than all 110, so
  // "relevant" means this club specifically. `news_items` has no team
  // tagging yet (Phase B2 lists it as outstanding); until it does, matching
  // the stored name against the headline is the honest way to do this, and
  // the panel simply omits itself when nothing matches rather than padding
  // with unrelated football.
  const clubIndex = buildClubIndex([team]);
  const clubNews = orderByRelevance(
    news.filter((n) => isRelevantHeadline(n.title, clubIndex)),
    clubIndex,
    CLUB_NEWS_COUNT,
  );

  const gradient = clubBarGradient(team.club_colors, team.club_colors);

  return (
    <div className="space-y-3">
      {/* Club identity. The colour bar is decoration on top of the name and
          crest, never the thing carrying it. */}
      <header className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="h-1 w-full" style={gradient ? { background: gradient } : undefined} aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <Crest team={{ ...team, fd_id: team.fd_id }} size={56} eager />
          <div className="min-w-0">
            <h1 className="font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-32">
              {team.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-muted">
              {league ? (
                <Link href={`/tables`} className={`inline-flex items-center gap-1.5 ${comp.hoverTextClass}`}>
                  <span className={`size-1.5 rounded-full ${comp.bgClass}`} aria-hidden="true" />
                  {league.name}
                </Link>
              ) : (
                // The 14 clubs retained for historical tables. Said plainly
                // rather than left as a blank line.
                <span>Not in a top-five league this season</span>
              )}
              {team.venue && <><span aria-hidden="true">·</span><span>{team.venue}</span></>}
              {team.founded !== null && <><span aria-hidden="true">·</span><span className="font-mono">Est. {team.founded}</span></>}
            </p>
          </div>

          {/* Season record and league position, when either is real. */}
          <dl className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-13">
            {standing && !usingLast && (
              <div>
                <dt className="text-11 uppercase tracking-wider text-muted">Position</dt>
                <dd className="text-18 font-bold tabular-nums">{position + 1}</dd>
              </div>
            )}
            {record ? (
              <>
                <div>
                  <dt className="text-11 uppercase tracking-wider text-muted">Played</dt>
                  <dd className="text-18 font-bold tabular-nums">{record.played}</dd>
                </div>
                <div>
                  <dt className="text-11 uppercase tracking-wider text-muted">W / D / L</dt>
                  <dd className="text-18 font-bold tabular-nums">{record.won}/{record.drawn}/{record.lost}</dd>
                </div>
                <div>
                  <dt className="text-11 uppercase tracking-wider text-muted">Goals</dt>
                  <dd className="text-18 font-bold tabular-nums">
                    {record.goalsFor}:{record.goalsAgainst}
                  </dd>
                </div>
              </>
            ) : (
              <div className="text-11 uppercase tracking-wider text-muted">No matches played yet</div>
            )}
          </dl>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3">
          <BoardPanel
            order={0}
            label="Next up"
            meta={upcoming.length > 0 ? `${upcoming.length} scheduled` : undefined}
            action={<Link href="/calendar" className="hover:text-text">All fixtures →</Link>}
          >
            <MatchdaySpine days={groupFixturesByDay(upcoming)} leagues={leagues} now={now} variant="compact" chromeless eagerCrests />
          </BoardPanel>

          <BoardPanel
            order={1}
            label="Results"
            action={<Link href="/scores" className="hover:text-text">Scores →</Link>}
          >
            {results.length > 0 ? (
              <MatchdaySpine days={groupFixturesByDay([...results].reverse())} leagues={leagues} now={now} variant="compact" chromeless />
            ) : (
              <p className="px-3 py-4 text-13 text-muted">
                No matches played yet{league ? ` in ${league.name}` : ''} — the season has not started.
              </p>
            )}
          </BoardPanel>
        </div>

        <div className="space-y-3">
          {standing && (
            <BoardPanel
              order={2}
              label="Table"
              meta={`${seasonLabel(standing.season)}${usingLast ? ' final' : ''}`}
              action={<Link href="/tables" className="hover:text-text">Full table →</Link>}
            >
              <dl className="grid grid-cols-3 gap-px bg-border sm:grid-cols-6">
                {[
                  // The position is real in both cases — this season's
                  // standing, or where they finished last season — and the
                  // panel's own meta line says which season it is showing,
                  // so there is nothing to disclaim by blanking it.
                  ['Pos', String(position + 1)],
                  ['P', String(standing.played)],
                  ['W', String(standing.won)],
                  ['D', String(standing.drawn)],
                  ['L', String(standing.lost)],
                  ['GD', formatGoalDifference(standing.goal_difference)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface px-3 py-2">
                    <dt className="text-11 uppercase tracking-wider text-muted">{label}</dt>
                    <dd className="font-mono text-15 font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-border px-3 py-2 font-mono text-13">
                <span className="text-muted">Points</span>{' '}
                <span className="text-18 font-bold tabular-nums">{standing.points}</span>
              </p>
            </BoardPanel>
          )}

          {squadGroups.length > 0 && (
            <BoardPanel order={3} label="Squad" meta={`${squad.length} players`}>
              {squadGroups.map(({ group, players }) => (
                <div key={group}>
                  <p className="border-b border-border bg-surface-2 px-3 py-1 text-11 font-semibold uppercase tracking-wider text-muted">
                    {group}
                  </p>
                  <ul>
                    {players.map((player) => (
                      <li
                        key={player.id}
                        className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
                      >
                        {/* Links to /player/[slug] now that it exists. This
                            was plain text for exactly as long as that route
                            did not — the same no-dead-ends rule /clubs
                            followed before /team/[slug] landed. */}
                        <Link href={`/player/${player.slug}`} className="truncate text-13 font-medium hover:underline">
                          {player.name}
                        </Link>
                        {player.nationality && (
                          <span className="shrink-0 font-mono text-11 text-muted">{player.nationality}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </BoardPanel>
          )}

          {clubNews.length > 0 && (
            <BoardPanel
              order={3}
              label="Latest"
              meta={team.short_name ?? team.name}
              action={<Link href="/news" className="hover:text-text">More →</Link>}
            >
              <NewsRail items={clubNews} now={now} />
            </BoardPanel>
          )}
        </div>
      </div>
    </div>
  );
}
