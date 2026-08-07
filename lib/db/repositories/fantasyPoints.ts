import { serviceClient } from '@/lib/db/client';
import { dedupeByKey } from '@/lib/db/dedupe';
import type { GameweekState } from '@/lib/ingest/gameweekSchedule';

export interface FantasyGameweekPointsRow {
  player_id: number;
  season: number;
  gameweek: number;
  points: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  clean_sheets: number | null;
  goals_conceded: number | null;
  own_goals: number | null;
  penalties_saved: number | null;
  penalties_missed: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  saves: number | null;
  bonus: number | null;
  is_final: boolean;
  updated_at: string;
}

/**
 * Deduped on the composite conflict target across the whole input before
 * chunking, for the same reason `upsertPlayerSeasonStats` does it: a
 * duplicate pair straddling a chunk boundary would make Postgres reject that
 * chunk with "ON CONFLICT DO UPDATE command cannot affect row a second
 * time". FPL should never send one player twice in a gameweek, but the
 * failure mode is a whole chunk lost, so it is not worth trusting.
 */
export async function upsertGameweekPoints(rows: FantasyGameweekPointsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.player_id}|${r.season}|${r.gameweek}`);
  const db = serviceClient();
  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await db
      .from('fantasy_gameweek_points')
      .upsert(deduped.slice(i, i + 500), { onConflict: 'player_id,season,gameweek' });
    if (error) throw new Error(`upsertGameweekPoints: ${error.message}`);
  }
}

/**
 * Which gameweeks of a season we already hold, and whether each is settled —
 * the input `planGameweekIngest` needs to decide what to fetch.
 *
 * A gameweek counts as final only when *every* stored row for it is final.
 * FPL sets `data_checked` for a whole gameweek at once, so a mixed state
 * means a partial write (a run that died mid-upsert), and re-fetching that
 * gameweek is exactly the repair. Reporting it final on the strength of one
 * settled row would make the gap permanent.
 *
 * Reads only the three columns the decision needs. That is one row per
 * player per gameweek — around 700 a week, ~26k across a full season — which
 * is a large-ish read but a cheap one, and PostgREST's default limit would
 * silently truncate it, so the range is set explicitly and a short read is
 * an error rather than a wrong answer.
 */
export async function getStoredGameweekState(season: number): Promise<GameweekState[]> {
  const db = serviceClient();
  const finalByGameweek = new Map<number, boolean>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('fantasy_gameweek_points')
      .select('gameweek, is_final')
      .eq('season', season)
      .order('gameweek', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getStoredGameweekState: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const soFar = finalByGameweek.get(row.gameweek);
      finalByGameweek.set(row.gameweek, (soFar ?? true) && row.is_final === true);
    }
    if (rows.length < PAGE) break;
  }

  return [...finalByGameweek.entries()]
    .map(([gameweek, isFinal]) => ({ gameweek, isFinal }))
    .sort((a, b) => a.gameweek - b.gameweek);
}

export interface FantasyPoolRow {
  player_id: number;
  season: number;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  price_tenths: number;
  updated_at: string;
}

/**
 * The season's pickable pool — price and FPL position per player.
 *
 * Prices move during a season as managers buy and sell, so this is a full
 * refresh on every run rather than an insert-once: the conflict target is
 * (player_id, season) and an existing row's price is overwritten with the
 * current one. A player who leaves the Premier League simply stops being
 * refreshed; their row stays, which is correct — a squad picked in October
 * still needs to know what its players were.
 */
export async function upsertFantasyPool(rows: FantasyPoolRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.player_id}|${r.season}`);
  const db = serviceClient();
  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await db
      .from('fantasy_player_season')
      .upsert(deduped.slice(i, i + 500), { onConflict: 'player_id,season' });
    if (error) throw new Error(`upsertFantasyPool: ${error.message}`);
  }
}

export interface FantasyGameweekRow {
  season: number;
  gameweek: number;
  name: string;
  deadline_utc: string | null;
  finished: boolean;
  is_final: boolean;
  is_current: boolean;
  updated_at: string;
}

/**
 * The season calendar, mirrored from FPL's `events`.
 *
 * The picker needs it to say which gameweek a save takes effect from and to
 * show a deadline. Both could in principle be inferred from which rows exist
 * in `fantasy_gameweek_points`, but inferring a schedule from the presence
 * of data is how a paused ingest run turns into a wrong deadline on a page.
 */
export async function upsertFantasyGameweeks(rows: FantasyGameweekRow[]): Promise<void> {
  if (rows.length === 0) return;
  const deduped = dedupeByKey(rows, (r) => `${r.season}|${r.gameweek}`);
  const { error } = await serviceClient()
    .from('fantasy_gameweek')
    .upsert(deduped, { onConflict: 'season,gameweek' });
  if (error) throw new Error(`upsertFantasyGameweeks: ${error.message}`);
}
