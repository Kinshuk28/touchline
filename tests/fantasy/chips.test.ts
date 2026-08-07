import { describe, it, expect } from 'vitest';
import {
  availableChips,
  chipErrors,
  captainMultiplierFor,
  benchCountsFor,
  grantsFreeTransfers,
  isOneWeekOnly,
  halfOf,
  describeChip,
  CHIPS,
  SECOND_HALF_FROM,
  type ChipPlay,
} from '@/lib/fantasy/chips';

const played = (...pairs: Array<[number, string]>): ChipPlay[] =>
  pairs.map(([gameweek, chip]) => ({ gameweek, chip: chip as ChipPlay['chip'] }));

describe('chip effects', () => {
  it('triples the captain only for Triple Captain', () => {
    expect(captainMultiplierFor('triple-captain')).toBe(3);
    for (const chip of [null, 'wildcard', 'free-hit', 'bench-boost'] as const) {
      expect(captainMultiplierFor(chip)).toBe(2);
    }
  });

  it('counts the bench only for Bench Boost', () => {
    expect(benchCountsFor('bench-boost')).toBe(true);
    for (const chip of [null, 'wildcard', 'free-hit', 'triple-captain'] as const) {
      expect(benchCountsFor(chip)).toBe(false);
    }
  });

  it('frees transfers for the Wildcard and the Free Hit, and nothing else', () => {
    expect(grantsFreeTransfers('wildcard')).toBe(true);
    expect(grantsFreeTransfers('free-hit')).toBe(true);
    expect(grantsFreeTransfers('triple-captain')).toBe(false);
    expect(grantsFreeTransfers(null)).toBe(false);
  });

  it('makes only the Free Hit side a one-week side', () => {
    // The Wildcard is a permanent rebuild; the Free Hit is a loan.
    expect(isOneWeekOnly('free-hit')).toBe(true);
    expect(isOneWeekOnly('wildcard')).toBe(false);
    expect(isOneWeekOnly(null)).toBe(false);
  });
});

describe('halfOf', () => {
  it('splits the season where the second wildcard becomes available', () => {
    expect(halfOf(1)).toBe(1);
    expect(halfOf(SECOND_HALF_FROM - 1)).toBe(1);
    expect(halfOf(SECOND_HALF_FROM)).toBe(2);
    expect(halfOf(38)).toBe(2);
  });
});

describe('availableChips', () => {
  it('offers all four to a manager who has played none', () => {
    expect(availableChips([], 1)).toEqual([...CHIPS]);
  });

  it('withdraws a chip once it has been played', () => {
    expect(availableChips(played([3, 'bench-boost']), 8)).not.toContain('bench-boost');
    expect(availableChips(played([3, 'bench-boost']), 8)).toContain('triple-captain');
  });

  it('keeps offering the chip already chosen for this gameweek', () => {
    // Reopening the picker before the deadline must show the chip you picked,
    // not tell you it is gone and leave your own selection unexplained.
    expect(availableChips(played([8, 'triple-captain']), 8)).toContain('triple-captain');
  });

  it('gives a second wildcard in the second half', () => {
    const first = played([5, 'wildcard']);
    expect(availableChips(first, 10)).not.toContain('wildcard');
    expect(availableChips(first, SECOND_HALF_FROM)).toContain('wildcard');
  });

  it('does not give a third wildcard', () => {
    const both = played([5, 'wildcard'], [25, 'wildcard']);
    expect(availableChips(both, 10)).not.toContain('wildcard');
    expect(availableChips(both, 30)).not.toContain('wildcard');
  });

  it('decides the wildcard half from the gameweek being played, not the one already used', () => {
    // A second-half wildcard does not consume the first-half one.
    const secondHalfOnly = played([25, 'wildcard']);
    expect(availableChips(secondHalfOnly, 10)).toContain('wildcard');
  });

  it('offers nothing already spent, and everything not', () => {
    const all = played([2, 'wildcard'], [5, 'free-hit'], [9, 'triple-captain'], [12, 'bench-boost']);
    expect(availableChips(all, 15)).toEqual([]);
    // The second-half wildcard is still to come.
    expect(availableChips(all, 25)).toEqual(['wildcard']);
  });
});

describe('chipErrors', () => {
  it('accepts no chip at all', () => {
    expect(chipErrors(null, played([3, 'wildcard']), 8)).toEqual([]);
  });

  it('accepts an available chip', () => {
    expect(chipErrors('bench-boost', [], 8)).toEqual([]);
  });

  it('names when a spent chip was used', () => {
    expect(chipErrors('bench-boost', played([3, 'bench-boost']), 8).join(' '))
      .toBe('You played Bench Boost in gameweek 3. Each chip is once a season.');
  });

  it('explains the wildcard halves rather than just refusing', () => {
    const firstHalf = chipErrors('wildcard', played([5, 'wildcard']), 10).join(' ');
    expect(firstHalf).toMatch(/first-half Wildcard/);
    expect(firstHalf).toMatch(new RegExp(`from gameweek ${SECOND_HALF_FROM}`));

    const secondHalf = chipErrors('wildcard', played([25, 'wildcard']), 30).join(' ');
    expect(secondHalf).toMatch(/second-half Wildcard/);
    // No pointer to a later wildcard, because there isn't one.
    expect(secondHalf).not.toMatch(/available from/);
  });

  it('rejects a value that is not a chip at all', () => {
    expect(chipErrors('nonsense' as never, [], 8)).toEqual(['nonsense is not a chip.']);
  });

  it('accepts re-saving the chip already chosen for this gameweek', () => {
    expect(chipErrors('free-hit', played([8, 'free-hit']), 8)).toEqual([]);
  });
});

describe('describeChip', () => {
  it('says what the chip does, not just its name', () => {
    expect(describeChip('bench-boost')).toBe(
      'Bench Boost: All fifteen players score, not just your eleven.',
    );
  });

  it('is null when no chip is played', () => {
    expect(describeChip(null)).toBeNull();
  });
});
