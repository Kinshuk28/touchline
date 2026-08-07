import { readClient } from '@/lib/site/supabase';

/**
 * The site's first read of `players` — the table has been populated by
 * `scripts/ingest/players.ts` since Phase A, but until `/team/[slug]`
 * nothing rendered it.
 *
 * Deliberately narrow: identity, position and nationality. Not
 * `date_of_birth` (a squad list has no room for it and an age would have to
 * be computed from a date that is null for many rows), and not
 * `photo_url` (null for the overwhelming majority — a grid of blank
 * portraits is exactly the "placeholder imagery" this project refuses).
 */
export interface SquadPlayer {
  id: number;
  slug: string;
  name: string;
  position: string | null;
  nationality: string | null;
}

/**
 * One club's squad, alphabetical by name. Ordering by name rather than by
 * position: `players.position` is free text from two different providers
 * ("Centre-Back", "Defender", "GKP"), so any position ordering would need a
 * mapping this build cannot verify — see `groupSquadByPosition` in
 * lib/site/squad.ts for how the page groups them honestly instead.
 */
export async function getSquad(teamId: number): Promise<SquadPlayer[]> {
  const { data, error } = await readClient()
    .from('players')
    .select('id,slug,name,position,nationality')
    .eq('team_id', teamId)
    .order('name', { ascending: true });
  if (error) throw new Error(`getSquad: ${error.message}`);
  return (data ?? []) as SquadPlayer[];
}

/**
 * One player, everything `/player/[slug]` shows about them. Wider than
 * `SquadPlayer`: the player page has room for a birth date, and it needs
 * `team_id` to link back to the club.
 *
 * `photo_url` is deliberately still absent. The column exists and is null
 * for the overwhelming majority of rows; a page built around a portrait
 * that usually isn't there would be a page built around a placeholder.
 */
export interface PlayerRow {
  id: number;
  slug: string;
  name: string;
  position: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  team_id: number | null;
}

/**
 * One player by URL slug, or `null` when nothing matches — same contract as
 * `getTeamBySlug`: an unknown slug is a 404, not an error.
 */
export async function getPlayerBySlug(slug: string): Promise<PlayerRow | null> {
  const { data, error } = await readClient()
    .from('players')
    .select('id,slug,name,position,nationality,date_of_birth,team_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`getPlayerBySlug: ${error.message}`);
  return (data as unknown as PlayerRow | null) ?? null;
}

/**
 * A player's stored season stats. One row per (season, source): the same
 * season can be covered by both `football-data` (scorer tables — goals and
 * assists for players who appear in them) and `fpl` (the Fantasy Premier
 * League bootstrap — appearances, minutes, cards for every PL player).
 *
 * Both are returned rather than merged. They measure different things over
 * different populations, and averaging or overwriting one with the other
 * would produce a number neither provider ever published — the page labels
 * each row with where it came from instead.
 */
export interface PlayerSeasonStats {
  season: number;
  source: 'fpl' | 'football-data';
  league_id: number;
  appearances: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
}

export async function getPlayerStats(playerId: number): Promise<PlayerSeasonStats[]> {
  const { data, error } = await readClient()
    .from('player_season_stats')
    .select('season,source,league_id,appearances,minutes,goals,assists,yellow_cards,red_cards')
    .eq('player_id', playerId)
    .order('season', { ascending: false });
  if (error) throw new Error(`getPlayerStats: ${error.message}`);
  return (data ?? []) as PlayerSeasonStats[];
}
