import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPlayerBySlug, getPlayerStats } from '@/lib/site/queries/players';
import { getTeamById } from '@/lib/site/queries/teams';
import { getFixturesForTeam } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getNewsForTeam } from '@/lib/site/queries/news';
import { getFantasySeason, getFantasyPlayerCard, isMissingTable, type FantasyPlayerCard } from '@/lib/site/queries/fantasy';
import { ageFrom, displayStats, playerNewsFirst, mentionsPlayer } from '@/lib/site/playerPage';
import { splitTeamFixtures } from '@/lib/site/teamPage';
import { squadGroupOf } from '@/lib/site/squad';
import { seasonLabel } from '@/lib/site/standingsDisplay';
import { getCompetitionMeta } from '@/lib/site/competition';
import { groupFixturesByDay } from '@/lib/site/spine';
import { formatPrice } from '@/lib/fantasy/squadRules';
import { BoardPanel } from '@/components/BoardPanel';
import { Crest } from '@/components/Crest';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { NewsRail } from '@/components/NewsRail';
import { PositionBadge } from '@/components/fantasy/badges';
import { PlayerFormChart } from '@/components/fantasy/charts';

/*
 * /player/[slug] — the other half of the club page. The squad list on
 * /team/[slug] rendered plain text precisely because this route did not
 * exist; now it links here.
 *
 * What this page can honestly be is set by what is stored: identity,
 * position, nationality, date of birth, current club, and season stats from
 * two providers — plus, for a Premier League player the fantasy game
 * tracks, real gameweek-by-gameweek points (`fantasy_gameweek_points`),
 * which is the form line a version of this comment used to say plainly did
 * not exist in this database. It still doesn't exist for anyone outside the
 * Premier League, or before the fantasy tables are applied — both handled
 * below by simply not showing the panel, never by inventing a number.
 */

export const revalidate = 300;

const CLUB_FIXTURE_COUNT = 5;
const CLUB_NEWS_FETCH = 20;
const PLAYER_NEWS_COUNT = 6;

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

  // Stories naming this player first, the rest of their club's news after —
  // there is no per-player tag in `news_items` (only `team_ids`), so this
  // reads the same club feed /team/[slug] already fetches via
  // `getNewsForTeam` and reorders it by surname mention
  // (`lib/site/playerPage.ts#playerNewsFirst`), rather than a query of its
  // own. Never empty because of the player specifically — a club with any
  // news at all always has something to show here.
  const clubNews = club ? await getNewsForTeam(club.id, CLUB_NEWS_FETCH) : [];
  const playerNews = playerNewsFirst(clubNews, player.name, PLAYER_NEWS_COUNT);
  const hasPlayerSpecificNews = playerNews.length > 0 && mentionsPlayer(playerNews[0]!.title, player.name);

  const fantasyCard = await getFantasyCardSafely(player.id);

  const stats = displayStats(rawStats);
  const age = ageFrom(player.date_of_birth, now);
  const league = club?.league_id != null ? leagues.find((l) => l.id === club.league_id) ?? null : null;
  const comp = getCompetitionMeta(league?.fd_code ?? '');
  const group = squadGroupOf(player.position);

  return (
    <div className="space-y-3">
      <header className="overflow-hidden rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* A real photo when one is stored (Premier League players merged
              against an FPL identity — see lib/site/queries/players.ts —
              which is most, but not all, of them), the club crest standing
              in for a portrait otherwise. Never a blank placeholder either
              way; this is one player, not the grid of mostly-empty avatars
              the same "photo_url is usually null" fact rules out on a
              squad list. */}
          {player.photo_url ? (
            <Image
              src={player.photo_url}
              alt=""
              width={72}
              height={72}
              className="shrink-0 rounded-full border border-border object-cover"
            />
          ) : club && (
            <Crest team={{ ...club, fd_id: club.fd_id }} size={48} eager />
          )}
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

        {(club && upcoming.length > 0) || fantasyCard || playerNews.length > 0 ? (
          <div className="space-y-3">
            {fantasyCard && (
              <BoardPanel order={1} label="Fantasy" meta={`${fantasyCard.seasonPoints} pts`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  <PositionBadge position={fantasyCard.position} />
                  <span className="font-mono text-13 font-semibold tabular-nums">
                    {formatPrice(fantasyCard.priceTenths)}
                  </span>
                  <Link href="/fantasy" className="ml-auto text-11 text-muted hover:text-text">
                    Pick a squad →
                  </Link>
                </div>
                {fantasyCard.gameweeks.some((g) => g.points !== null) ? (
                  <PlayerFormChart gameweeks={fantasyCard.gameweeks} />
                ) : (
                  <p className="px-3 py-4 text-13 text-muted">
                    No gameweek has been scored yet this season.
                  </p>
                )}
              </BoardPanel>
            )}

            {club && upcoming.length > 0 && (
              <BoardPanel
                order={2}
                label={`${club.short_name ?? club.name} next`}
                action={<Link href={`/team/${club.slug}`} className="hover:text-text">Club page →</Link>}
              >
                {/* The club's fixtures, not a prediction that this player
                    plays in them — squad selection is not something this
                    database knows, so the panel is labelled by the club, not
                    the player. */}
                <MatchdaySpine days={groupFixturesByDay(upcoming)} leagues={leagues} now={now} variant="compact" chromeless />
              </BoardPanel>
            )}

            {playerNews.length > 0 && club && (
              <BoardPanel
                order={3}
                // Honest about which of the two this actually is: stories
                // that name the player by surname read differently from a
                // club's general news feed shown because nothing did.
                label={hasPlayerSpecificNews ? 'News' : `${club.short_name ?? club.name} news`}
                meta={hasPlayerSpecificNews ? undefined : `nothing recent names ${player.name.split(' ').at(-1)}`}
                action={<Link href="/news" className="hover:text-text">More →</Link>}
              >
                <NewsRail items={playerNews} now={now} />
              </BoardPanel>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The fantasy card is Premier-League-only and depends on migrations the
 * project owner applies by hand (see docs/superpowers/specs/2026-08-07-
 * fantasy-phase-c.md) — both `getFantasyPlayerCard` returning `null` and the
 * table not existing yet are ordinary, expected states here, not errors.
 * Either way the player page renders exactly as it did before this panel
 * existed, never a 500.
 */
async function getFantasyCardSafely(playerId: number): Promise<FantasyPlayerCard | null> {
  try {
    const season = await getFantasySeason();
    if (season === null) return null;
    return await getFantasyPlayerCard(season, playerId);
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) return null;
    throw err;
  }
}
