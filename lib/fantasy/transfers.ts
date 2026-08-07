import { grantsFreeTransfers, type Chip } from '@/lib/fantasy/chips';

/**
 * Transfers: how a squad changes between gameweeks, and what changing it costs.
 *
 * Until now a save replaced the whole side. That is right for the first pick
 * and wrong for every one after it — a fantasy season is a squad you keep and
 * adjust, and the adjusting is most of the game. What makes it a game rather
 * than a shopping trip is that changes are rationed: one free transfer a
 * gameweek, unused ones bank up to a limit, and anything beyond that is paid
 * for in points.
 *
 * Pure. No database, no clock. Every rule below is one assertion in
 * tests/fantasy/transfers.test.ts.
 */

/** Free transfers accrue at one a gameweek and stop banking here. */
export const MAX_BANKED_TRANSFERS = 5;

/** What each transfer beyond the free allowance costs, in points. */
export const TRANSFER_POINTS = 4;

/** One gameweek in which a manager saved a side, and how many changes it made. */
export interface TransferRecord {
  gameweek: number;
  transfersMade: number;
  /**
   * The chip played that gameweek, if any. A Wildcard or Free Hit makes the
   * week's transfers free *and* leaves the bank untouched — see
   * `transferAllowance`.
   */
  chip?: Chip | null;
}

export interface SquadDiff {
  /** Players who were not in the previous side. */
  in: number[];
  /** Players who were, and are not now. */
  out: number[];
  /** How many transfers this represents. */
  count: number;
}

/**
 * What changed between two sides.
 *
 * Order and slots are ignored on purpose: moving a player from the bench into
 * the eleven, changing the captain or reordering substitutes are all free and
 * always have been. A transfer is a change of *personnel*.
 *
 * `count` is the number of players who came in, which equals the number who
 * left whenever both sides are full squads. It is deliberately not
 * `max(in, out)`: an incomplete previous side (a save that half-failed) should
 * report the players actually bought rather than inflating the bill.
 */
export function transfersBetween(previous: readonly number[], next: readonly number[]): SquadDiff {
  const before = new Set(previous);
  const after = new Set(next);
  const arrived = next.filter((id) => !before.has(id));
  const departed = previous.filter((id) => !after.has(id));
  return { in: arrived, out: departed, count: arrived.length };
}

export interface TransferAllowance {
  /** How many changes cost nothing this gameweek. */
  free: number;
  /**
   * True while the squad has never been locked in. Picking a first squad is
   * not a transfer, and rebuilding it before its own deadline is not either —
   * nothing has been played, so there is nothing to ration.
   */
  unlimited: boolean;
}

/**
 * How many free transfers a manager has for a gameweek.
 *
 * One accrues every gameweek, whether or not a side was saved — a manager who
 * ignores the game for a month comes back with a bank, not a penalty. Unused
 * ones stack to `MAX_BANKED_TRANSFERS` and stop; taking a hit does not put the
 * bank into debt, it just leaves the next week at one.
 *
 * `history` is one record per gameweek a side was actually saved for. The
 * gaps between them are gameweeks the previous side simply carried, and they
 * accrue at one each, which is why this walks the whole range rather than
 * folding over the records.
 *
 * A gameweek played with a Wildcard or Free Hit spends nothing: those chips
 * make transfers free, and FPL's rule — the one that makes a wildcard feel
 * like a gift rather than a trade — is that banked transfers survive it. So
 * a manager who wildcards on twelve transfers in gameweek 8 still has their
 * saved ones in gameweek 9.
 */
export function transferAllowance(
  history: readonly TransferRecord[],
  gameweek: number,
): TransferAllowance {
  if (history.length === 0) return { free: Number.POSITIVE_INFINITY, unlimited: true };

  const first = Math.min(...history.map((r) => r.gameweek));
  // Re-saving the side that has not yet been played is still the initial pick.
  if (gameweek <= first) return { free: Number.POSITIVE_INFINITY, unlimited: true };

  const usedAt = new Map(history.map((r) => [r.gameweek, r.transfersMade]));
  const chipAt = new Map(history.map((r) => [r.gameweek, r.chip ?? null]));

  // The gameweek after the first squad opens with exactly one.
  let free = 1;
  for (let week = first + 1; week < gameweek; week += 1) {
    const used = grantsFreeTransfers(chipAt.get(week) ?? null) ? 0 : usedAt.get(week) ?? 0;
    // A hit spends the bank down to nothing but never below it, then the next
    // week's transfer accrues on top.
    free = Math.min(MAX_BANKED_TRANSFERS, Math.max(0, free - used) + 1);
  }

  return { free, unlimited: false };
}

/**
 * The allowance as a chip leaves it.
 *
 * A Wildcard or Free Hit makes this gameweek's transfers free, which is the
 * same state as before a first squad is locked in — so it is expressed the
 * same way rather than threaded through every caller as a separate flag.
 * `transferCost` and `describeTransfers` then need to know nothing about
 * chips at all.
 */
export function effectiveAllowance(allowance: TransferAllowance, chip: Chip | null): TransferAllowance {
  if (!grantsFreeTransfers(chip)) return allowance;
  return { free: Number.POSITIVE_INFINITY, unlimited: true };
}

/**
 * The points deducted for a set of transfers.
 *
 * Never negative, and never a bonus for using fewer than the allowance —
 * unused transfers bank (see `transferAllowance`) rather than paying out.
 */
export function transferCost(made: number, allowance: TransferAllowance): number {
  if (allowance.unlimited) return 0;
  return Math.max(0, made - allowance.free) * TRANSFER_POINTS;
}

/**
 * The line a picker shows above the save button.
 *
 * Written out in full rather than as counters because the number that matters
 * — what this is about to cost — should not have to be inferred from two
 * others.
 */
export function describeTransfers(
  made: number,
  allowance: TransferAllowance,
  chip: Chip | null = null,
): string {
  if (allowance.unlimited) {
    if (grantsFreeTransfers(chip)) {
      return made === 0
        ? 'Change as many players as you like — this week is free.'
        : `${made} transfer${made === 1 ? '' : 's'}, and no points cost this week.`;
    }
    return made === 0 ? 'Free transfers until your first deadline.' : 'No transfer cost for your first squad.';
  }

  const cost = transferCost(made, allowance);
  const free = `${allowance.free} free transfer${allowance.free === 1 ? '' : 's'}`;

  if (made === 0) return `No changes yet — ${free} available.`;
  if (cost === 0) return `${made} transfer${made === 1 ? '' : 's'}, ${free} available — no points cost.`;

  const paid = made - allowance.free;
  return `${made} transfers, ${free} available — ${paid} extra cost${paid === 1 ? 's' : ''} ${cost} points.`;
}
