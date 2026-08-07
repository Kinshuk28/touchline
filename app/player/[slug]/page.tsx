import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPlayerBySlug, getPlayerStats } from '@/lib/site/queries/players';
import { getTeamById } from '@/lib/site/queries/teams';
import { getFixturesForTeam } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { ageFrom, displayStats } from '@/lib/site/playerPage';
import { splitTeamFixtures } from '@/lib/site/teamPage';
import { squadGroupOf } from '@/lib/site/squad';
import { seasonLabel } from '@/lib/site/standingsDisplay';
import { getCompetitionMeta } from '@/lib/site/competition';
import { groupFixturesByDay } from '@/lib/site/spine';
import { BoardPanel } from '@/components/BoardPanel';
import { Crest } from '@/components/Crest';
import { MatchdaySpine } from '@/components/MatchdaySpine';

/*
 * /player/[slug] — the other half of the club page. The squad list on
 * /team/[slug] rendered plain text precisely because this route did not
 * exist; now it links here.
 *
 * What this page can honestly be is set by what is stored: identity,
 * position, nationality, date of birth, current club, and season stats from
 * two providers. There is no per-match player data in this database, so
 * there is no minutes-by-match chart and no form line — the page shows what
 * exists and says nothing about what doesn't.
 */

export const revalidate = 300;

const CLUB_FIXTURE_COUNT = 5;

// Column definitions once, so the header and every row cannot drift apart.
const STAT_COLUMNS = [
  ['Apps', (r: { appearances: number | null }) => r.appearances],
  ['Mins', (r: { minutes: number | null }) => r.minutes],
  ['Goals', (r: { goals: number | null }) => r.goals],
  ['Assists', (r: { assists: number | null }) => r.assists],
  ['Yellow', (r: { yellow_cards: number | null }) => r.yellow_cards],
  ['Red', (r: { red_cards: number | null }) => r.red_cards],
] as const;

const SOURCE_LABEL: Record<'fpl' | 'football-data', string> = {
  'football-data': 'football-data.org',
  fpl: 'Fantasy PL',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) return { title: 'Player not found — Touchline' };
  return {
    title: `${player.name} — Touchline`,
    description: `Club, position and season statistics for ${player.name}.`,
  };
}

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const now = new Date();
  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  const [rawStats, club, leagues] = await Promise.all([
    getPlayerStats(player.id),
    player.team_id !== null ? getTeamById(player.team_id) : Promise.resolve(null),
    getLeagues(),
  ]);

  // The club's next matches, as context — this is a player page, so it is
  // deliberately short (five) and clearly labelled as the club's fixtures,
  // not a claim that this player will feature in them. Selection is nothing
  // this app can know.
  const clubFixtures = club ? await getFixturesForTeam(club.id, 20) : [];
  const { upcoming } = splitTeamFixtures(clubFixtures, now, { upcoming: CLUB_FIXTURE_COUNT });

  const stats = displayStats(rawStats);
  const age = ageFrom(player.date_of_birth, now);
  const league = club?.league_id != null ? leagues.find((l) => l.id === club.league_id) ?? null : null;
  const comp = getCompetitionMeta(league?.fd_code ?? '');
  const group = squadGroupOf(player.position);

  return (
    <div className="space-y-3">
      <header className="overflow-hidden rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* The club crest stands in for a portrait. `players.photo_url` is
              null for nearly every row, and a grid of blank avatars is the
              placeholder imagery this project refuses — a crest is real,
              stored, and tells you who they play for. */}
          {club && <Crest team={{ ...club, fd_id: club.fd_id }} size={48} eager />}
          <div className="min-w-0">
            <h1 className="font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-32">
              {player.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-muted">
              {club ? (
                <Link href={`/team/${club.slug}`} className={`inline-flex items-center gap-1.5 ${comp.hoverTextClass}`}>
                  {league && <span className={`size-1.5 rounded-full ${comp.bgClass}`} aria-hidden="true" />}
                  {club.name}
                </Link>
              ) : (
                // `players.team_id` is nullable and a transfer can empty it.
                <span>Club not recorded</span>
              )}
              {/* Position as stored, plus the group it maps to only when the
                  two say different things — "Goalkeeper (Goalkeepers)" is
                  noise. */}
              {player.position && <><span aria-hidden="true">·</span><span>{player.position}</span></>}
              {!player.position && group === 'Position not recorded' && (
                <><span aria-hidden="true">·</span><span>Position not recorded</span></>
              )}
              {player.nationality && <><span aria-hidden="true">·</span><span>{player.nationality}</span></>}
              {age !== null && <><span aria-hidden="true">·</span><span className="font-mono">{age}</span></>}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <BoardPanel
          order={0}
          label="Season stats"
          meta={stats.length > 0 ? `${stats.length} recorded` : undefined}
        >
          {stats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-13">
                <caption className="sr-only">
                  Season statistics for {player.name}, one row per season and source
                </caption>
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-11 uppercase tracking-wide text-muted">
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">Season</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">Source</th>
                    {STAT_COLUMNS.map(([label]) => (
                      <th key={label} scope="col" className="px-2 py-1.5 text-right font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={`${row.season}-${row.source}`} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-1.5 font-mono tabular-nums">{seasonLabel(row.season)}</td>
                      {/* Named, never blended: the two providers count
                          different populations, and a row has to say which
                          one it is. */}
                      <td className="px-3 py-1.5 text-muted">{SOURCE_LABEL[row.source]}</td>
                      {STAT_COLUMNS.map(([label, read]) => {
                        const value = read(row);
                        return (
                          <td key={label} className="px-2 py-1.5 text-right font-mono tabular-nums">
                            {/* A metric this source doesn't publish is blank,
                                not a zero — zero goals and no goals data are
                                different facts. */}
                            {value === null ? <span className="text-muted">—</span> : value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-4 text-13 text-muted">
              No season statistics on file for {player.name} yet. The player job records them per
              competition once a season is under way.
            </p>
          )}
        </BoardPanel>

        {club && upcoming.length > 0 && (
          <BoardPanel
            order={1}
            label={`${club.short_name ?? club.name} next`}
            action={<Link href={`/team/${club.slug}`} className="hover:text-text">Club page →</Link>}
          >
            {/* The club's fixtures, not a prediction that this player plays
                in them — squad selection is not something this database
                knows, so the panel is labelled by the club, not the player. */}
            <MatchdaySpine days={groupFixturesByDay(upcoming)} leagues={leagues} now={now} variant="compact" chromeless />
          </BoardPanel>
        )}
      </div>
    </div>
  );
}
