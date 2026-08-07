import { userClient } from '@/lib/auth/session';
import type { FantasyPosition } from '@/lib/fantasy/squadRules';
import type { PickGeneration, ScoredGameweek } from '@/lib/fantasy/standings';

/**
 * Leagues, and the reads a league table is made of.
 *
 * Like `lib/fantasy/squadStore.ts` this uses the signed-in user's own token,
 * so every query below is answered under the policies in
 * supabase/migrations/0009. In particular: this file contains no check that
 * the caller is a member of the league it is asked about, because there is
 * nowhere for such a check to be the truth — a non-member's query returns no
 * rows whether or not TypeScript remembered to ask.
 */

export interface LeagueSummary {
  id: string;
  name: string;
  season: number;
  ownerId: string;
  /** How a friend gets in. Shown to members; nobody else can read the row at all. */
  joinCode: string;
  memberCount: number;
}

export async function getMyLeagues(accessToken: string, season: number): Promise<LeagueSummary[]> {
  const db = userClient(accessToken);

  const { data, error } = await db
    .from('fantasy_league')
    .select('id,name,season,owner_id,join_code')
    .eq('season', season)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getMyLeagues: ${error.message}`);

  const leagues = (data ?? []) as Array<{
    id: string; name: string; season: number; owner_id: string; join_code: string;
  }>;
  if (leagues.length === 0) return [];

  // One membership query for every league at once. The policy already limits
  // it to leagues this user is in, which is the same set.
  const { data: members, error: memberError } = await db
    .from('fantasy_league_member')
    .select('league_id')
    .in('league_id', leagues.map((l) => l.id));
  if (memberError) throw new Error(`getMyLeagues (members): ${memberError.message}`);

  const counts = new Map<string, number>();
  for (const row of (members ?? []) as Array<{ league_id: string }>) {
    counts.set(row.league_id, (counts.get(row.league_id) ?? 0) + 1);
  }

  return leagues.map((l) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    ownerId: l.owner_id,
    joinCode: l.join_code,
    memberCount: counts.get(l.id) ?? 0,
  }));
}

export async function getLeague(accessToken: string, leagueId: string): Promise<LeagueSummary | null> {
  const db = userClient(accessToken);
  const { data, error } = await db
    .from('fantasy_league')
    .select('id,name,season,owner_id,join_code')
    .eq('id', leagueId)
    .maybeSingle();
  if (error) throw new Error(`getLeague: ${error.message}`);
  if (!data) return null;

  const league = data as { id: string; name: string; season: number; owner_id: string; join_code: string };
  const { count, error: countError } = await db
    .from('fantasy_league_member')
    .select('user_id', { count: 'exact', head: true })
    .eq('league_id', leagueId);
  if (countError) throw new Error(`getLeague (members): ${countError.message}`);

  return {
    id: league.id,
    name: league.name,
    season: league.season,
    ownerId: league.owner_id,
    joinCode: league.join_code,
    memberCount: count ?? 0,
  };
}

export interface MemberSquad {
  userId: string;
  squadId: string | null;
  squadName: string;
  generations: PickGeneration[];
  /** Gameweek → points docked for transfers. Empty for a manager who has never taken a hit. */
  transferCosts: Map<number, number>;
}

export interface LeagueScoringData {
  members: MemberSquad[];
  gameweeks: ScoredGameweek[];
  positions: Map<number, FantasyPosition>;
}

/**
 * Everything needed to compute one league's table, in five queries.
 *
 * The shape is dictated by what RLS will hand over. A rival's squad row is
 * readable because you share a league; a rival's *picks* are readable only
 * for generations whose deadline has passed (0009). So a member who has
 * picked a side for the coming gameweek and nothing before it comes back
 * with an empty `generations` — which is correct, and the table shows them
 * on no points rather than pretending to know their team.
 *
 * Points are fetched only for players who actually appear in somebody's
 * squad, not for the whole league: a ten-manager league touches perhaps two
 * hundred players, and fetching every price-listed player's every gameweek
 * would be ~26,000 rows to compute ten numbers.
 */
export async function getLeagueScoringData(
  accessToken: string,
  leagueId: string,
  season: number,
): Promise<LeagueScoringData> {
  const db = userClient(accessToken);

  const { data: memberRows, error: memberError } = await db
    .from('fantasy_league_member')
    .select('user_id')
    .eq('league_id', leagueId);
  if (memberError) throw new Error(`getLeagueScoringData (members): ${memberError.message}`);
  const userIds = ((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  if (userIds.length === 0) return { members: [], gameweeks: [], positions: new Map() };

  const { data: squadRows, error: squadError } = await db
    .from('fantasy_squad')
    .select('id,user_id,name')
    .eq('season', season)
    .in('user_id', userIds);
  if (squadError) throw new Error(`getLeagueScoringData (squads): ${squadError.message}`);
  const squads = (squadRows ?? []) as Array<{ id: string; user_id: string; name: string }>;
  const squadByUser = new Map(squads.map((s) => [s.user_id, s]));

  const picksBySquad = new Map<string, PickGeneration[]>();
  const playerIds = new Set<number>();

  if (squads.length > 0) {
    const { data: pickRows, error: pickError } = await db
      .from('fantasy_pick')
      .select('squad_id,active_from_gameweek,slot,player_id,is_captain,is_vice_captain')
      .in('squad_id', squads.map((s) => s.id))
      .order('slot', { ascending: true });
    if (pickError) throw new Error(`getLeagueScoringData (picks): ${pickError.message}`);

    for (const row of (pickRows ?? []) as Array<{
      squad_id: string; active_from_gameweek: number; slot: number;
      player_id: number; is_captain: boolean; is_vice_captain: boolean;
    }>) {
      playerIds.add(row.player_id);
      const generations = picksBySquad.get(row.squad_id) ?? [];
      let generation = generations.find((g) => g.activeFromGameweek === row.active_from_gameweek);
      if (!generation) {
        generation = { activeFromGameweek: row.active_from_gameweek, picks: [] };
        generations.push(generation);
      }
      generation.picks.push({
        playerId: row.player_id,
        slot: row.slot,
        captain: row.is_captain,
        viceCaptain: row.is_vice_captain,
      });
      picksBySquad.set(row.squad_id, generations);
    }
  }

  // Points docked for transfers, per squad per gameweek. Same visibility rule
  // as the picks they describe (0010): a league-mate's row is readable once
  // that gameweek's deadline has passed, so a table can be computed but a
  // rival's pending changes stay private.
  const costsBySquad = new Map<string, Map<number, number>>();
  if (squads.length > 0) {
    const { data: costRows, error: costError } = await db
      .from('fantasy_squad_gameweek')
      .select('squad_id,gameweek,transfer_cost')
      .in('squad_id', squads.map((s) => s.id));
    if (costError) throw new Error(`getLeagueScoringData (transfers): ${costError.message}`);

    for (const row of (costRows ?? []) as Array<{ squad_id: string; gameweek: number; transfer_cost: number }>) {
      const forSquad = costsBySquad.get(row.squad_id) ?? new Map<number, number>();
      forSquad.set(row.gameweek, row.transfer_cost);
      costsBySquad.set(row.squad_id, forSquad);
    }
  }

  const members: MemberSquad[] = userIds.map((userId) => {
    const squad = squadByUser.get(userId);
    return {
      userId,
      squadId: squad?.id ?? null,
      // A member with no squad still belongs in the table. Naming them
      // "No squad yet" rather than blank is the difference between a row
      // that explains itself and one that looks like a rendering bug.
      squadName: squad?.name ?? 'No squad yet',
      generations: squad ? picksBySquad.get(squad.id) ?? [] : [],
      transferCosts: squad ? costsBySquad.get(squad.id) ?? new Map() : new Map(),
    };
  });

  if (playerIds.size === 0) return { members, gameweeks: [], positions: new Map() };

  const ids = [...playerIds];
  const [gameweeks, positions] = await Promise.all([
    getPointsForPlayers(accessToken, season, ids),
    getPositionsForPlayers(accessToken, season, ids),
  ]);

  return { members, gameweeks, positions };
}

/**
 * Gameweek scores for a named set of players, grouped by gameweek.
 *
 * `fantasy_gameweek_points` is public-read, so this could use the anon
 * client — it takes the user's token only so that a league page makes all
 * its requests as one identity, which is easier to reason about than a page
 * that switches clients halfway through.
 */
async function getPointsForPlayers(
  accessToken: string,
  season: number,
  playerIds: readonly number[],
): Promise<ScoredGameweek[]> {
  const db = userClient(accessToken);
  const byGameweek = new Map<number, ScoredGameweek>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('fantasy_gameweek_points')
      .select('gameweek,player_id,points,minutes')
      .eq('season', season)
      .in('player_id', playerIds)
      .order('gameweek', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getPointsForPlayers: ${error.message}`);

    const rows = (data ?? []) as Array<{
      gameweek: number; player_id: number; points: number | null; minutes: number | null;
    }>;
    for (const row of rows) {
      const week = byGameweek.get(row.gameweek) ?? { gameweek: row.gameweek, lines: [] };
      week.lines.push({ playerId: row.player_id, points: row.points, minutes: row.minutes });
      byGameweek.set(row.gameweek, week);
    }
    if (rows.length < PAGE) break;
  }

  return [...byGameweek.values()].sort((a, b) => a.gameweek - b.gameweek);
}

/** Positions, so auto-substitutions in past gameweeks respect the formation. */
async function getPositionsForPlayers(
  accessToken: string,
  season: number,
  playerIds: readonly number[],
): Promise<Map<number, FantasyPosition>> {
  const { data, error } = await userClient(accessToken)
    .from('fantasy_player_season')
    .select('player_id,position')
    .eq('season', season)
    .in('player_id', playerIds);
  if (error) throw new Error(`getPositionsForPlayers: ${error.message}`);
  return new Map(
    ((data ?? []) as Array<{ player_id: number; position: FantasyPosition }>)
      .map((row) => [row.player_id, row.position]),
  );
}

export async function createLeague(
  accessToken: string,
  userId: string,
  season: number,
  name: string,
): Promise<string> {
  // `join_code` is left to the column default and the owner's membership row
  // to the trigger — both in 0009, both deliberately not this code's job.
  const { data, error } = await userClient(accessToken)
    .from('fantasy_league')
    .insert({ owner_id: userId, season, name })
    .select('id')
    .single();
  if (error) throw new Error(`createLeague: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Join by code, through the definer function in 0009.
 *
 * Not an insert: `authenticated` holds no INSERT grant on
 * `fantasy_league_member` precisely so that the code is the only way in.
 * Joining a league you are already in is a no-op, not an error — people
 * click old invite links.
 */
export async function joinLeague(accessToken: string, code: string): Promise<string> {
  const { data, error } = await userClient(accessToken).rpc('fantasy_join_league', { p_code: code });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function leaveLeague(accessToken: string, leagueId: string, userId: string): Promise<void> {
  const { error } = await userClient(accessToken)
    .from('fantasy_league_member')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', userId);
  if (error) throw new Error(`leaveLeague: ${error.message}`);
}
