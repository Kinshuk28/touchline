import { describe, it, expect } from 'vitest';
import {
  transfersBetween,
  transferAllowance,
  transferCost,
  describeTransfers,
  effectiveAllowance,
  MAX_BANKED_TRANSFERS,
  TRANSFER_POINTS,
  type TransferRecord,
} from '@/lib/fantasy/transfers';

const FIFTEEN = Array.from({ length: 15 }, (_, i) => i + 1);

describe('transfersBetween', () => {
  it('counts nothing when the same fifteen come back', () => {
    expect(transfersBetween(FIFTEEN, FIFTEEN)).toEqual({ in: [], out: [], count: 0 });
  });

  it('ignores slot changes entirely — a transfer is a change of personnel', () => {
    // Reordering, benching, swapping the captaincy: all free, and all of them
    // arrive here as the same fifteen ids in a different order.
    expect(transfersBetween(FIFTEEN, [...FIFTEEN].reverse()).count).toBe(0);
  });

  it('names who came in and who went out', () => {
    const next = [...FIFTEEN.slice(0, 13), 98, 99];
    const diff = transfersBetween(FIFTEEN, next);
    expect(diff.in).toEqual([98, 99]);
    expect(diff.out).toEqual([14, 15]);
    expect(diff.count).toBe(2);
  });

  it('counts a first squad as fifteen arrivals', () => {
    // Only ever reached with an empty previous side, where the allowance is
    // unlimited and the count is not billed — but it should still be the
    // truthful number.
    expect(transfersBetween([], FIFTEEN).count).toBe(15);
  });

  it('reports players bought, not the larger of the two lists', () => {
    // A previous side left incomplete by a half-failed save must not inflate
    // the bill for the players actually bought.
    const diff = transfersBetween([1, 2, 3], [1, 2, 3, 4]);
    expect(diff.count).toBe(1);
    expect(diff.out).toEqual([]);
  });
});

describe('transferAllowance', () => {
  const history = (...pairs: Array<[number, number]>): TransferRecord[] =>
    pairs.map(([gameweek, transfersMade]) => ({ gameweek, transfersMade }));

  it('is unlimited before any side has been locked in', () => {
    expect(transferAllowance([], 1)).toEqual({ free: Infinity, unlimited: true });
  });

  it('is still unlimited while re-saving the first squad before its own deadline', () => {
    // Nothing has been played, so there is nothing to ration.
    expect(transferAllowance(history([3, 15]), 3).unlimited).toBe(true);
  });

  it('opens the following gameweek with exactly one', () => {
    expect(transferAllowance(history([1, 15]), 2)).toEqual({ free: 1, unlimited: false });
  });

  it('banks an unused transfer', () => {
    expect(transferAllowance(history([1, 15]), 3).free).toBe(2);
    expect(transferAllowance(history([1, 15]), 4).free).toBe(3);
  });

  it('accrues through gameweeks where nothing was saved', () => {
    // A manager who ignores the game for a month comes back with a bank, not
    // a penalty.
    expect(transferAllowance(history([1, 15]), 5).free).toBe(4);
  });

  it('stops banking at the cap', () => {
    expect(transferAllowance(history([1, 15]), 20).free).toBe(MAX_BANKED_TRANSFERS);
  });

  it('spends the bank when transfers are used', () => {
    // GW1 initial. GW2 opens with 1, uses 1 → GW3 opens with 1 again.
    expect(transferAllowance(history([1, 15], [2, 1]), 3).free).toBe(1);
    // Bank two by GW3, spend both → GW4 back to 1.
    expect(transferAllowance(history([1, 15], [3, 2]), 4).free).toBe(1);
  });

  it('does not put the bank into debt after a hit', () => {
    // Four transfers on one free one is a 12-point hit, not a three-week ban.
    expect(transferAllowance(history([1, 15], [2, 4]), 3).free).toBe(1);
  });

  it('ignores records for gameweeks at or after the one being asked about', () => {
    // A side saved for a later gameweek cannot have spent this gameweek's
    // allowance.
    expect(transferAllowance(history([1, 15], [9, 5]), 3).free).toBe(2);
  });

  it('does not depend on the history arriving in order', () => {
    const shuffled = history([3, 2], [1, 15], [2, 1]);
    expect(transferAllowance(shuffled, 4).free).toBe(1);
  });
});

describe('transferCost', () => {
  const limited = (free: number) => ({ free, unlimited: false });

  it('charges nothing for the first squad, however many players it names', () => {
    expect(transferCost(15, { free: Infinity, unlimited: true })).toBe(0);
  });

  it('charges nothing inside the allowance', () => {
    expect(transferCost(0, limited(2))).toBe(0);
    expect(transferCost(2, limited(2))).toBe(0);
  });

  it('charges four points for each transfer beyond it', () => {
    expect(transferCost(3, limited(2))).toBe(TRANSFER_POINTS);
    expect(transferCost(5, limited(1))).toBe(4 * TRANSFER_POINTS);
  });

  it('never pays out for unused transfers', () => {
    // They bank instead — see transferAllowance.
    expect(transferCost(0, limited(5))).toBe(0);
  });
});

describe('describeTransfers', () => {
  const limited = (free: number) => ({ free, unlimited: false });

  it('says the cost outright rather than leaving it to be inferred', () => {
    expect(describeTransfers(3, limited(1))).toBe(
      '3 transfers, 1 free transfer available — 2 extra cost 8 points.',
    );
  });

  it('uses the singular where English needs it', () => {
    expect(describeTransfers(1, limited(1))).toBe('1 transfer, 1 free transfer available — no points cost.');
    expect(describeTransfers(2, limited(1))).toMatch(/1 extra costs 4 points/);
  });

  it('says what is available when nothing has changed', () => {
    expect(describeTransfers(0, limited(3))).toBe('No changes yet — 3 free transfers available.');
  });

  it('does not talk about allowances before the first deadline', () => {
    expect(describeTransfers(0, { free: Infinity, unlimited: true })).toMatch(/until your first deadline/);
    expect(describeTransfers(15, { free: Infinity, unlimited: true })).toMatch(/No transfer cost/);
  });
});

describe('chips and the transfer bank', () => {
  const history = (...triples: Array<[number, number, string | null]>): TransferRecord[] =>
    triples.map(([gameweek, transfersMade, chip]) => ({
      gameweek,
      transfersMade,
      chip: chip as TransferRecord['chip'],
    }));

  it('leaves the bank untouched when a wildcard week made twelve transfers', () => {
    // Without this a wildcard would cost a manager every saved transfer, and
    // the chip would feel like a trade rather than a gift.
    const banked = history([1, 15, null], [8, 12, 'wildcard']);
    // GW1 initial, then +1 a week to GW8 (5, capped), wildcard spends none,
    // so GW9 is still capped.
    expect(transferAllowance(banked, 9).free).toBe(MAX_BANKED_TRANSFERS);
  });

  it('does the same for a free hit', () => {
    const banked = history([1, 15, null], [3, 14, 'free-hit']);
    // GW2 opens at 1, GW3's free hit spends nothing, GW4 accrues to 3.
    expect(transferAllowance(banked, 4).free).toBe(3);
  });

  it('still spends the bank for a chip that does not free transfers', () => {
    const spent = history([1, 15, null], [3, 2, 'triple-captain']);
    expect(transferAllowance(spent, 4).free).toBe(1);
  });
});

describe('effectiveAllowance', () => {
  const limited = { free: 1, unlimited: false };

  it('makes a wildcard or free hit week unlimited', () => {
    expect(effectiveAllowance(limited, 'wildcard')).toEqual({ free: Infinity, unlimited: true });
    expect(effectiveAllowance(limited, 'free-hit')).toEqual({ free: Infinity, unlimited: true });
  });

  it('leaves the allowance alone for every other chip and for none', () => {
    expect(effectiveAllowance(limited, 'triple-captain')).toBe(limited);
    expect(effectiveAllowance(limited, 'bench-boost')).toBe(limited);
    expect(effectiveAllowance(limited, null)).toBe(limited);
  });

  it('makes any number of transfers cost nothing once applied', () => {
    expect(transferCost(12, effectiveAllowance(limited, 'wildcard'))).toBe(0);
  });
});

describe('describeTransfers — chip weeks', () => {
  const free = { free: Infinity, unlimited: true };

  it('says the week is free rather than talking about a first deadline', () => {
    expect(describeTransfers(0, free, 'wildcard')).toBe(
      'Change as many players as you like — this week is free.',
    );
    expect(describeTransfers(9, free, 'free-hit')).toBe('9 transfers, and no points cost this week.');
    expect(describeTransfers(1, free, 'wildcard')).toBe('1 transfer, and no points cost this week.');
  });

  it('still says "first deadline" when that is genuinely why it is free', () => {
    expect(describeTransfers(0, free, null)).toMatch(/until your first deadline/);
  });
});
