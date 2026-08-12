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
 * `photo_url` is included here — unlike `SquadPlayer`, which deliberately
 * excludes it — because this is a single player, not a grid of them. A
 * squad list of fifteen names where a handful carry a photo and the rest
 * don't is the "placeholder imagery" problem this project refuses; one
 * player's own page choosing between a real photo and the existing crest
 * fallback is the opposite of that, the same "show it when it's real, fall
 * back honestly when it's not" rule `components/Crest.tsx` and
 * `components/NewsCard.tsx`'s type-only variant already follow. It stays
 * `null` for the great majority of rows regardless — `scripts/ingest/
 * players.ts` only ever sets it via an FPL identity match, and FPL covers
 * the Premier League alone, so a La Liga or Serie A player's page falls
 * back to the crest exactly as it always has.
 */
export interface PlayerRow {
  id: number;
  slug: string;
  name: string;
  position: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  team_id: number | null;
  photo_url: string | null;
}

/**
 * One player by URL slug, or `null` when nothing matches — same contract as
 * `getTeamBySlug`: an unknown slug is a 404, not an error.
 */
export async function getPlayerBySlug(slug: string): Promise<PlayerRow | null> {
  const { data, error } = await readClient()
    .from('players')
    .select('id,slug,name,position,nationality,date_of_birth,team_id,photo_url')
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
