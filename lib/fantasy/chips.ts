/**
 * Chips: the four one-off moves a manager gets in a season.
 *
 * Everything else in this game is a rule that applies every week. A chip is
 * the opposite — a rule you get to break once, on a week of your choosing,
 * and choosing that week well is most of what makes a season interesting.
 *
 * Each chip changes exactly one thing, and each of those things already
 * exists as a parameter somewhere:
 *
 *   - **Wildcard** — transfers are free this week (`lib/fantasy/transfers.ts`).
 *   - **Free Hit** — transfers are free *and* the side lasts one gameweek,
 *     after which the previous one resumes (`lib/fantasy/standings.ts`).
 *   - **Triple Captain** — the captain's multiplier is 3, not 2
 *     (`lib/fantasy/scoring.ts`).
 *   - **Bench Boost** — all fifteen score, not eleven (`lib/fantasy/scoring.ts`).
 *
 * Which is why chips are a module of rules rather than a feature bolted onto
 * a picker: the effects were already parameters, and this file only decides
 * which are switched on, and when they may be.
 *
 * Pure. Every rule below is one assertion in tests/fantasy/chips.test.ts.
 */

export type Chip = 'wildcard' | 'free-hit' | 'triple-captain' | 'bench-boost';

export const CHIPS: readonly Chip[] = ['wildcard', 'free-hit', 'triple-captain', 'bench-boost'];

export const CHIP_LABELS: Readonly<Record<Chip, string>> = {
  wildcard: 'Wildcard',
  'free-hit': 'Free Hit',
  'triple-captain': 'Triple Captain',
  'bench-boost': 'Bench Boost',
};

export const CHIP_DESCRIPTIONS: Readonly<Record<Chip, string>> = {
  wildcard: 'Change as many players as you like this gameweek, with no points cost.',
  'free-hit': 'A one-week side, free to build. Your squad comes back next gameweek.',
  'triple-captain': 'Your captain scores triple instead of double.',
  'bench-boost': 'All fifteen players score, not just your eleven.',
};

/**
 * The two chips that make transfers free.
 *
 * They also do not spend banked free transfers — see `transferAllowance`,
 * which reads this. A manager who wildcards in gameweek 8 still has whatever
 * they had saved when gameweek 9 comes round, which is the rule FPL settled
 * on and the one that makes a wildcard feel like a gift rather than a trade.
 */
export const UNLIMITED_TRANSFER_CHIPS: readonly Chip[] = ['wildcard', 'free-hit'];

export function grantsFreeTransfers(chip: Chip | null): boolean {
  return chip !== null && UNLIMITED_TRANSFER_CHIPS.includes(chip);
}

/** The captain's multiplier this gameweek. */
export function captainMultiplierFor(chip: Chip | null): number {
  return chip === 'triple-captain' ? 3 : 2;
}

/** Whether the bench scores this gameweek. */
export function benchCountsFor(chip: Chip | null): boolean {
  return chip === 'bench-boost';
}

/**
 * A side picked under a Free Hit belongs to its own gameweek and no other.
 *
 * This is the one chip that changes what a *stored* squad means, which is
 * why it needs a predicate of its own rather than living inside a scoring
 * option: both the scorer and the picker have to agree that the week after a
 * Free Hit resumes the side from before it.
 */
export function isOneWeekOnly(chip: Chip | null): boolean {
  return chip === 'free-hit';
}

/** One chip, and the gameweek it was played in. */
export interface ChipPlay {
  gameweek: number;
  chip: Chip;
}

/**
 * The season splits in two for wildcard purposes, and the second one starts
 * here. One wildcard per half is FPL's rule and the reason the chip is worth
 * saving rather than spending in August.
 */
export const SECOND_HALF_FROM = 20;

export function halfOf(gameweek: number): 1 | 2 {
  return gameweek < SECOND_HALF_FROM ? 1 : 2;
}

/**
 * Which chips a manager may still play, for a given gameweek.
 *
 * Three rules, and they compose:
 *
 * 1. **One chip per gameweek.** Playing two at once is not a strategy, it is
 *    a way to spend a season's chips on one afternoon.
 * 2. **Each chip once a season** — except the wildcard, which comes twice,
 *    one per half.
 * 3. A chip already played *in this gameweek* still counts as available, so
 *    that reopening the picker before the deadline shows the chip you chose
 *    rather than telling you it is gone.
 *
 * Rule 3 is easy to get wrong and annoying when it is: without it, a manager
 * who plays a chip and comes back an hour later finds it greyed out and
 * their own selection unexplained.
 */
export function availableChips(played: readonly ChipPlay[], gameweek: number): Chip[] {
  const thisWeek = played.find((p) => p.gameweek === gameweek)?.chip ?? null;
  const earlier = played.filter((p) => p.gameweek !== gameweek);

  return CHIPS.filter((chip) => {
    if (chip === thisWeek) return true;

    if (chip === 'wildcard') {
      // One per half, and the half is decided by the gameweek being played,
      // not by when the other wildcard was used.
      return !earlier.some((p) => p.chip === 'wildcard' && halfOf(p.gameweek) === halfOf(gameweek));
    }
    return !earlier.some((p) => p.chip === chip);
  });
}

/**
 * Why this chip cannot be played this gameweek, or an empty list when it can.
 *
 * Checked on the server before anything is written, so a chip is never spent
 * by a request the picker would have refused.
 */
export function chipErrors(
  chip: Chip | null,
  played: readonly ChipPlay[],
  gameweek: number,
): string[] {
  if (chip === null) return [];

  if (!CHIPS.includes(chip)) return [`${chip} is not a chip.`];
  if (availableChips(played, gameweek).includes(chip)) return [];

  if (chip === 'wildcard') {
    const half = halfOf(gameweek);
    return [
      `You have already played your ${half === 1 ? 'first-half' : 'second-half'} Wildcard. ` +
        (half === 1 ? `The second one is available from gameweek ${SECOND_HALF_FROM}.` : ''),
    ].map((s) => s.trim());
  }

  const when = played.find((p) => p.chip === chip)?.gameweek;
  return [`You played ${CHIP_LABELS[chip]} in gameweek ${when}. Each chip is once a season.`];
}

/** The line the picker shows when a chip is active. */
export function describeChip(chip: Chip | null): string | null {
  return chip === null ? null : `${CHIP_LABELS[chip]}: ${CHIP_DESCRIPTIONS[chip]}`;
}
