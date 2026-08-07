import { scoreSquad, type PlayerGameweek, type SquadPick } from '@/lib/fantasy/scoring';
import type { FantasyPosition } from '@/lib/fantasy/squadRules';

/**
 * A season's worth of scoring — one squad, every gameweek, in order.
 *
 * `scoreSquad` answers "what did this eleven score last weekend". A league
 * table needs the other question: what has this manager scored *all season*,
 * given that the eleven changed along the way.
 *
 * The whole difficulty is that last part. Picks are stored as generations
 * (`fantasy_pick.active_from_gameweek`, see supabase/migrations/0008), so
 * gameweek 3 must be scored against the side that was picked for gameweek 3,
 * not the side showing in the picker today. Scoring every week against the
 * current squad would make a manager's history rewrite itself every time
 * they made a change — and it would reward changing your side after seeing
 * the results, which is the one thing a fantasy game cannot allow.
 *
 * Pure. No database, no clock, no network.
 */

/** One saved side, and the gameweek it took effect from. */
export interface PickGeneration {
  activeFromGameweek: number;
  picks: SquadPick[];
}

/** One gameweek's published player scores. */
export interface ScoredGameweek {
  gameweek: number;
  lines: PlayerGameweek[];
}

export interface GameweekResult {
  gameweek: number;
  points: number;
  /** Picks whose scores FPL has not published — the reason a total can still move. */
  pending: number;
}

export interface SeasonScore {
  total: number;
  /** Every gameweek this squad was picked for, in order. */
  gameweeks: GameweekResult[];
  /** Total across every pick still awaiting a published score. */
  pending: number;
}

/**
 * Which side was in force for a given gameweek: the newest generation saved
 * at or before it.
 *
 * `null` when the manager had not picked a side yet — a league someone joins
 * in October has nine gameweeks they were not playing, and those are not
 * zeroes. A zero says "played and scored nothing"; there is a real
 * difference and a season total that quietly includes the first half of a
 * season a manager never entered is wrong.
 */
export function generationFor(
  generations: readonly PickGeneration[],
  gameweek: number,
): PickGeneration | null {
  let best: PickGeneration | null = null;
  for (const generation of generations) {
    if (generation.activeFromGameweek > gameweek) continue;
    if (best === null || generation.activeFromGameweek > best.activeFromGameweek) best = generation;
  }
  return best;
}

/**
 * One squad's season.
 *
 * Gameweeks with no side in force are skipped entirely rather than scored as
 * zero — see `generationFor`. Gameweeks are returned in order regardless of
 * the order they arrived in, because this feeds a table people read.
 */
export function scoreSeason(
  generations: readonly PickGeneration[],
  gameweeks: readonly ScoredGameweek[],
  opts: { positions?: ReadonlyMap<number, FantasyPosition> } = {},
): SeasonScore {
  const results: GameweekResult[] = [];
  let total = 0;
  let pending = 0;

  for (const week of [...gameweeks].sort((a, b) => a.gameweek - b.gameweek)) {
    const generation = generationFor(generations, week.gameweek);
    if (generation === null) continue;

    const score = scoreSquad(generation.picks, week.lines, opts);
    total += score.total;
    pending += score.pending;
    results.push({ gameweek: week.gameweek, points: score.total, pending: score.pending });
  }

  return { total, gameweeks: results, pending };
}

export interface LeagueEntry {
  userId: string;
  squadName: string;
  /** Null for a member who has joined but not yet picked a side. */
  score: SeasonScore | null;
}

export interface RankedEntry extends LeagueEntry {
  /** 1-based. Tied managers share a position, and the next one skips — 1, 2, 2, 4. */
  rank: number;
  total: number;
  /** This gameweek's points, `null` when they were not playing that week. */
  latest: number | null;
}

/**
 * A league table.
 *
 * Ties share a rank and the following position skips — the way every league
 * table anyone has ever read works. Managers who have not picked a side sit
 * at the bottom on no points, listed rather than hidden: a league of six
 * that displays four is a league that looks broken to the two.
 *
 * The tie-break after points is the squad name, which is arbitrary but
 * stable. Anything cleverer (most goals, earliest joined) would be a rule
 * nobody was told about, and a table that reorders between two page loads is
 * worse than one with an arbitrary but fixed order.
 */
export function rankLeague(entries: readonly LeagueEntry[], latestGameweek: number | null): RankedEntry[] {
  const scored = entries.map((entry) => ({
    ...entry,
    total: entry.score?.total ?? 0,
    latest:
      latestGameweek === null
        ? null
        : entry.score?.gameweeks.find((g) => g.gameweek === latestGameweek)?.points ?? null,
  }));

  scored.sort((a, b) => (b.total - a.total) || a.squadName.localeCompare(b.squadName));

  const ranked: RankedEntry[] = [];
  scored.forEach((entry, index) => {
    const previous = ranked[index - 1];
    // Equal totals share a rank; the next distinct total takes the position
    // it would have had anyway, so the numbers still count the field.
    const rank = previous !== undefined && previous.total === entry.total ? previous.rank : index + 1;
    ranked.push({ ...entry, rank });
  });

  return ranked;
}
