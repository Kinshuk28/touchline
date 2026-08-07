/**
 * The rules that make a squad legal — and therefore the rules that make the
 * game a game.
 *
 * `lib/fantasy/scoring.ts` deliberately stops at structure (slots,
 * captaincy, duplicates) because it is handed points, not players. Shape,
 * club limits and budget need to know what each player *is*, and that is
 * what this module is given.
 *
 * The budget is the load-bearing rule. Without it every manager picks the
 * same fifteen best players and the league table is a tie; scarcity is the
 * only reason a choice is a choice. Prices come from FPL's `now_cost` and
 * are stored per season in `fantasy_player_season` — see
 * supabase/migrations/0007.
 *
 * Pure, and shared by both sides on purpose: the picker validates with these
 * functions as you click, and the server action re-validates with the same
 * ones before writing. A client-side check is a courtesy, never a control.
 */

export type FantasyPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

export const POSITIONS: readonly FantasyPosition[] = ['GK', 'DEF', 'MID', 'FWD'];

export const POSITION_LABELS: Record<FantasyPosition, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

/** What a player has to be for this module to judge them. */
export interface PickablePlayer {
  playerId: number;
  position: FantasyPosition;
  /** FPL's `now_cost`: tenths of a million, so 125 is £12.5m. */
  priceTenths: number;
  /** Null for a player whose club we have not resolved — see `clubCounts`. */
  teamId: number | null;
}

/** How many of each position a full squad holds. Totals 15. */
export const SQUAD_SHAPE: Readonly<Record<FantasyPosition, number>> = {
  GK: 2, DEF: 5, MID: 5, FWD: 3,
};

/** How many of each position may start. The XI must total 11 within these. */
export const FORMATION_LIMITS: Readonly<Record<FantasyPosition, readonly [number, number]>> = {
  GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3],
};

export const MAX_PER_CLUB = 3;
export const BUDGET_TENTHS = 1000; // £100.0m
export const STARTING_SLOTS = 11;
export const SQUAD_SIZE = 15;

/** `125` → `"£12.5m"`. One place, so the picker and any page agree. */
export function formatPrice(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

export function totalCost(players: readonly PickablePlayer[]): number {
  return players.reduce((sum, p) => sum + p.priceTenths, 0);
}

export function countByPosition(players: readonly PickablePlayer[]): Record<FantasyPosition, number> {
  const counts: Record<FantasyPosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) counts[p.position] += 1;
  return counts;
}

/**
 * How many players come from each club.
 *
 * A player with no `teamId` is left out of the count rather than grouped
 * under a shared "unknown" bucket, which would invent a club limit between
 * players who have nothing to do with each other. Unresolved clubs are rare
 * (a player FPL added since the last squads run) and counting them as
 * unlimited is the lesser error: the alternative silently blocks a legal
 * pick with a rule the manager cannot see.
 */
export function clubCounts(players: readonly PickablePlayer[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const p of players) {
    if (p.teamId === null) continue;
    counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
  }
  return counts;
}

/** Is this set of starters a formation football recognises? */
export function isLegalFormation(counts: Record<FantasyPosition, number>): boolean {
  const total = POSITIONS.reduce((sum, pos) => sum + counts[pos], 0);
  if (total !== STARTING_SLOTS) return false;
  return POSITIONS.every((pos) => {
    const [min, max] = FORMATION_LIMITS[pos];
    return counts[pos] >= min && counts[pos] <= max;
  });
}

/**
 * Could a partly-filled eleven still become a legal formation?
 *
 * The picker needs this and `isLegalFormation` cannot answer it: a lineup of
 * one keeper and five defenders is not legal, but it is perfectly fine
 * *so far*. Placing players without this check is how an auto-arranged
 * squad fills all eleven slots with defenders and midfielders and leaves no
 * room for a forward — a legal fifteen arranged into an illegal eleven,
 * which is a worse first impression than refusing the pick outright.
 *
 * The test is exact rather than heuristic: every position still short of its
 * minimum needs one of the remaining slots, so the shortfalls have to fit in
 * what is left.
 */
export function canStillCompleteFormation(counts: Record<FantasyPosition, number>): boolean {
  const total = POSITIONS.reduce((sum, pos) => sum + counts[pos], 0);
  if (total > STARTING_SLOTS) return false;

  let shortfall = 0;
  for (const pos of POSITIONS) {
    const [min, max] = FORMATION_LIMITS[pos];
    if (counts[pos] > max) return false;
    shortfall += Math.max(0, min - counts[pos]);
  }
  return shortfall <= STARTING_SLOTS - total;
}

/** `{GK:1,DEF:4,MID:4,FWD:2}` → `"4-4-2"`. The keeper is never written. */
export function formationName(counts: Record<FantasyPosition, number>): string {
  return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
}

/**
 * Everything wrong with a 15-player selection, as sentences a manager can
 * act on.
 *
 * Returns every problem rather than the first: a picker that reports "too
 * many midfielders" and then, once fixed, "over budget" makes the manager
 * discover the rules one refusal at a time.
 */
export function selectionErrors(players: readonly PickablePlayer[]): string[] {
  const errors: string[] = [];

  const ids = players.map((p) => p.playerId);
  if (new Set(ids).size !== ids.length) errors.push('The same player is picked twice.');

  if (players.length !== SQUAD_SIZE) {
    errors.push(`A squad is ${SQUAD_SIZE} players; you have ${players.length}.`);
  }

  const counts = countByPosition(players);
  for (const pos of POSITIONS) {
    const want = SQUAD_SHAPE[pos];
    if (counts[pos] !== want) {
      errors.push(`${POSITION_LABELS[pos]}: ${counts[pos]} of ${want}.`);
    }
  }

  const cost = totalCost(players);
  if (cost > BUDGET_TENTHS) {
    errors.push(`Over budget by ${formatPrice(cost - BUDGET_TENTHS)}.`);
  }

  for (const [teamId, n] of clubCounts(players)) {
    if (n > MAX_PER_CLUB) {
      // The club's *name* belongs in the message, but this module is not
      // given names — the picker substitutes it. Keeping the id here rather
      // than accepting a name map keeps the rule pure and the message
      // resolvable at the one place that has the roster.
      errors.push(`More than ${MAX_PER_CLUB} players from club ${teamId} (${n}).`);
    }
  }

  return errors;
}

/**
 * Everything wrong with a lineup, given a legal-or-not selection.
 *
 * Separate from `selectionErrors` because the two are answered at different
 * moments: you build fifteen, then you decide who starts. Reporting "your
 * formation is illegal" while a manager is still three players short is
 * noise.
 *
 * A missing vice-captain is legal and not reported. `lib/fantasy/scoring.ts`
 * handles it exactly as you would expect — a captain who does not play
 * simply doubles nothing — and refusing to save over it would be this
 * module inventing a rule.
 */
export function lineupErrors(
  starters: readonly PickablePlayer[],
  armbands: { captainId: number | null; viceCaptainId: number | null },
): string[] {
  const errors: string[] = [];

  if (starters.length !== STARTING_SLOTS) {
    errors.push(`Start ${STARTING_SLOTS} players; you have ${starters.length}.`);
  } else if (!isLegalFormation(countByPosition(starters))) {
    const counts = countByPosition(starters);
    errors.push(
      `${formationName(counts)} is not a legal formation — ` +
        'one keeper, at least three defenders, two midfielders and one forward.',
    );
  }

  const startingIds = new Set(starters.map((p) => p.playerId));
  const { captainId, viceCaptainId } = armbands;

  if (captainId === null) {
    errors.push('Pick a captain.');
  } else if (!startingIds.has(captainId)) {
    errors.push('The captain must be in the starting eleven.');
  }

  if (viceCaptainId !== null) {
    if (!startingIds.has(viceCaptainId)) {
      errors.push('The vice-captain must be in the starting eleven.');
    }
    if (viceCaptainId === captainId) {
      errors.push('The captain cannot also be vice-captain.');
    }
  }

  return errors;
}

/**
 * Turn a lineup into the numbered slots the database stores.
 *
 * Slots are not decoration: `lib/fantasy/scoring.ts` reads 1-11 as the
 * starting eleven and 12-15 as the bench *in substitution order*, so the
 * order this function produces is the order a blank starter is replaced in.
 *
 * The reserve keeper takes slot 12 by convention, matching FPL, and matching
 * what the scorer needs: a keeper is only ever a substitute for a keeper, so
 * a bench with the spare keeper first is the one arrangement where a
 * position-aware auto-sub and a naive one agree most often.
 */
export function assignSlots(
  starters: readonly PickablePlayer[],
  bench: readonly PickablePlayer[],
): Array<{ playerId: number; slot: number }> {
  const orderedStarters = [...starters].sort(
    (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position),
  );
  const reserveKeepers = bench.filter((p) => p.position === 'GK');
  const outfield = bench.filter((p) => p.position !== 'GK');
  const orderedBench = [...reserveKeepers, ...outfield];

  return [
    ...orderedStarters.map((p, i) => ({ playerId: p.playerId, slot: i + 1 })),
    ...orderedBench.map((p, i) => ({ playerId: p.playerId, slot: STARTING_SLOTS + 1 + i })),
  ];
}

/**
 * Can this player be swapped into the starting eleven for that one, and stay
 * legal?
 *
 * The picker asks this on every hover to decide what to grey out, which is
 * the difference between a lineup editor that teaches the rules and one that
 * refuses moves without saying why.
 */
export function canSwap(
  starters: readonly PickablePlayer[],
  out: PickablePlayer,
  incoming: PickablePlayer,
): boolean {
  if (out.position === incoming.position) return true;
  const counts = countByPosition(starters);
  counts[out.position] -= 1;
  counts[incoming.position] += 1;
  return isLegalFormation(counts);
}
