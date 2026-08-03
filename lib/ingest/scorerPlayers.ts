import { slugWithFdId } from '@/lib/db/slug';
import { upsertPlayersByFdId, type PlayerRow } from '@/lib/db/repositories/players';
import type { RawScorer } from '@/lib/providers/types';

/**
 * Creates a `players` row for every scorer whose `playerFdId` is not already
 * in `playerIds`, from the bio fields the scorers payload itself carries.
 *
 * This exists because `getSquad` returns an empty squad array for every La
 * Liga and Serie A club (verified live: Barcelona id 81, Inter id 108 both
 * squad 0) — those two leagues have no other free source of players at all.
 * The scorers endpoint's embedded `player` object is the only place their
 * bio data comes from, so a scorer id missing from the player-id map is
 * created here rather than silently dropped when writing
 * `player_season_stats`.
 *
 * Never invents data: any bio field absent from the payload (position is
 * always null in this endpoint, as of the 2025-26 season snapshot) is
 * stored as `null`, matching the RawScorer contract. `photo_url` is always
 * null — football-data.org provides no player photography anywhere.
 *
 * `slug` follows the exact `${slugify(name)}-${fdId}` convention the
 * backfill's squad-based player rows already use, so a player later found
 * in a real squad (e.g. after football-data fixes the La Liga/Serie A squad
 * gap) upserts onto the same row via the shared `fd_id` conflict target
 * instead of creating a duplicate.
 *
 * Returns the new rows created (for reporting), keyed by their scorer
 * entry so callers can re-resolve the id map afterward — this function does
 * not query the database for ids itself, since the caller already owns
 * that round trip and batches it once per league/season, not once per call.
 */
export function newPlayersFromScorers(
  scorers: RawScorer[],
  teamIds: ReadonlyMap<number, number>,
  playerIds: ReadonlyMap<number, number>,
) {
  const seen = new Set<number>();
  const rows: PlayerRow[] = [];

  for (const sc of scorers) {
    if (playerIds.has(sc.playerFdId) || seen.has(sc.playerFdId)) continue;
    seen.add(sc.playerFdId);
    rows.push({
      fd_id: sc.playerFdId,
      fpl_id: null,
      team_id: teamIds.get(sc.teamFdId) ?? null,
      slug: slugWithFdId(sc.playerName, sc.playerFdId),
      name: sc.playerName,
      position: sc.position,
      nationality: sc.nationality,
      date_of_birth: sc.dateOfBirth,
      photo_url: null,
    });
  }
  return rows;
}

export async function createMissingScorerPlayers(
  scorers: RawScorer[],
  teamIds: ReadonlyMap<number, number>,
  playerIds: ReadonlyMap<number, number>,
): Promise<number> {
  const rows = newPlayersFromScorers(scorers, teamIds, playerIds);
  if (rows.length > 0) await upsertPlayersByFdId(rows);
  return rows.length;
}
