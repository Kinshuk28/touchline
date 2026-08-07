import { readClient } from '@/lib/site/supabase';
import type { FantasyPosition } from '@/lib/fantasy/squadRules';
import type { GameweekWindow } from '@/lib/fantasy/gameweekWindow';

/**
 * The public half of the fantasy game: who can be picked, what they cost,
 * and when the next deadline is.
 *
 * Read with the anon key like every other query in this directory. None of
 * it is anyone's data — the squads are `lib/fantasy/squadStore.ts`, which
 * needs a signed-in user's token and lives outside `lib/site/` for exactly
 * that reason.
 */

export interface PoolPlayer {
  playerId: number;
  slug: string;
  name: string;
  position: FantasyPosition;
  priceTenths: number;
  teamId: number | null;
  teamName: string | null;
  teamTla: string | null;
  /** Season points so far, `null` when no gameweek has been scored yet. */
  seasonPoints: number | null;
}

interface PoolRow {
  player_id: number;
  position: FantasyPosition;
  price_tenths: number;
  players: {
    slug: string;
    name: string;
    team_id: number | null;
    teams: { name: string; tla: string | null } | null;
  } | null;
}

/**
 * Every pickable player for a season, with the club and price the picker
 * needs to enforce the rules.
 *
 * One query with two embedded joins rather than three round trips: PostgREST
 * resolves `players` through the foreign key and `teams` through the one on
 * `players`, and the picker needs all of it at once to render a single
 * sortable list.
 *
 * The range is explicit because the pool is ~700 rows and PostgREST's
 * default limit is 1000 — close enough that a silent truncation is a
 * realistic future bug, and a squad picker missing its cheapest defenders is
 * a hard thing to notice.
 */
export async function getPlayerPool(season: number): Promise<PoolPlayer[]> {
  const { data, error } = await readClient()
    .from('fantasy_player_season')
    .select('player_id,position,price_tenths,players!inner(slug,name,team_id,teams(name,tla))')
    .eq('season', season)
    .order('price_tenths', { ascending: false })
    .range(0, 4999);
  if (error) throw new Error(`getPlayerPool: ${error.message}`);

  return ((data ?? []) as unknown as PoolRow[]).flatMap((row) => {
    // `players!inner` means this should never be null; a pool entry with no
    // player is unpickable either way, and dropping it beats rendering a
    // nameless row.
    if (row.players === null) return [];
    return [{
      playerId: row.player_id,
      slug: row.players.slug,
      name: row.players.name,
      position: row.position,
      priceTenths: row.price_tenths,
      teamId: row.players.team_id,
      teamName: row.players.teams?.name ?? null,
      teamTla: row.players.teams?.tla ?? null,
      seasonPoints: null,
    }];
  });
}

/**
 * Season points per player, summed from the gameweeks scored so far.
 *
 * Separate from the pool because it is genuinely separate data with a
 * different lifetime — the pool changes when a price changes, this changes
 * every weekend — and because a squad can be picked perfectly well before a
 * ball is kicked, when this returns nothing at all.
 *
 * Summed in code rather than in the database: PostgREST cannot group without
 * a view, and adding one for an aggregate over a table this size would be a
 * migration to save an addition.
 */
export async function getSeasonPoints(season: number): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await readClient()
      .from('fantasy_gameweek_points')
      .select('player_id,points')
      .eq('season', season)
      .not('points', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getSeasonPoints: ${error.message}`);
    const rows = (data ?? []) as Array<{ player_id: number; points: number | null }>;
    for (const row of rows) {
      if (row.points === null) continue;
      totals.set(row.player_id, (totals.get(row.player_id) ?? 0) + row.points);
    }
    if (rows.length < PAGE) break;
  }

  return totals;
}

export interface Gameweek extends GameweekWindow {
  name: string;
  isCurrent: boolean;
  isFinal: boolean;
}

export async function getFantasyCalendar(season: number): Promise<Gameweek[]> {
  const { data, error } = await readClient()
    .from('fantasy_gameweek')
    .select('gameweek,name,deadline_utc,finished,is_final,is_current')
    .eq('season', season)
    .order('gameweek', { ascending: true });
  if (error) throw new Error(`getFantasyCalendar: ${error.message}`);

  return ((data ?? []) as Array<{
    gameweek: number; name: string; deadline_utc: string | null;
    finished: boolean; is_final: boolean; is_current: boolean;
  }>).map((row) => ({
    gameweek: row.gameweek,
    name: row.name,
    deadlineUtc: row.deadline_utc,
    finished: row.finished,
    isFinal: row.is_final,
    isCurrent: row.is_current,
  }));
}

/**
 * The season the fantasy game is being played in.
 *
 * Read from the Premier League's own `current_season` rather than declared
 * as a constant here: `lib/ingest/leagueSeed.ts` has one, but `app/` and
 * `lib/site/` must not import from `lib/ingest/`, and a second copy of the
 * year is a copy that will be a year stale one August. The database already
 * knows, and ingest is what keeps it right.
 */
export async function getFantasySeason(): Promise<number | null> {
  const { data, error } = await readClient()
    .from('leagues')
    .select('current_season')
    .eq('fd_code', 'PL')
    .maybeSingle();
  if (error) throw new Error(`getFantasySeason: ${error.message}`);
  return (data as { current_season: number } | null)?.current_season ?? null;
}

/**
 * Does the fantasy game have a database behind it yet?
 *
 * supabase/migrations/0006-0008 are applied by hand by the project owner, so
 * between this code deploying and that happening, every query above fails
 * with "relation does not exist". `/fantasy` uses this to say so plainly
 * instead of showing a 500 — the same treatment `/status` gives its own
 * unapplied migration.
 *
 * PostgREST reports a missing relation as PGRST205 with its own message, not
 * as Postgres's 42P01 — this project has been caught by that difference
 * before (see lib/site/ingestHealth.ts).
 */
export function isMissingTable(message: string): boolean {
  return /PGRST205|PGRST106|does not exist|schema cache/i.test(message);
}
