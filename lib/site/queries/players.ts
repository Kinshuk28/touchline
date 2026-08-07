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
