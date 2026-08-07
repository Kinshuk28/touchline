import { describe, it, expect } from 'vitest';
import {
  generationFor,
  scoreSeason,
  rankLeague,
  type PickGeneration,
  type ScoredGameweek,
  type LeagueEntry,
} from '@/lib/fantasy/standings';
import type { PlayerGameweek, SquadPick } from '@/lib/fantasy/scoring';

/** Fifteen picks; `ids` names the eleven who start, in slot order. */
function side(ids: number[]): SquadPick[] {
  const bench = [101, 102, 103, 104];
  return [
    ...ids.map((playerId, i) => ({ playerId, slot: i + 1, captain: i === 0 })),
    ...bench.map((playerId, i) => ({ playerId, slot: 12 + i })),
  ];
}

const XI_A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const XI_B = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];

/** Everyone named scores `points` off 90 minutes; the rest score nothing but played. */
function week(gameweek: number, points: number, only?: number[]): ScoredGameweek {
  const ids = [...XI_A, ...XI_B, 101, 102, 103, 104];
  return {
    gameweek,
    lines: ids.map((playerId): PlayerGameweek => ({
      playerId,
      points: only === undefined || only.includes(playerId) ? points : 0,
      minutes: 90,
    })),
  };
}

describe('generationFor', () => {
  const generations: PickGeneration[] = [
    { activeFromGameweek: 1, picks: side(XI_A) },
    { activeFromGameweek: 5, picks: side(XI_B) },
  ];

  it('picks the newest side saved at or before the gameweek', () => {
    expect(generationFor(generations, 1)!.activeFromGameweek).toBe(1);
    expect(generationFor(generations, 4)!.activeFromGameweek).toBe(1);
    expect(generationFor(generations, 5)!.activeFromGameweek).toBe(5);
    expect(generationFor(generations, 38)!.activeFromGameweek).toBe(5);
  });

  it('returns null for a gameweek before the manager had picked anything', () => {
    // Not zero. A zero says "played and scored nothing"; this is "was not
    // playing", and a season total that includes weeks somebody never
    // entered is simply wrong.
    expect(generationFor(generations, 0)).toBeNull();
    expect(generationFor([{ activeFromGameweek: 10, picks: [] }], 9)).toBeNull();
  });

  it('does not depend on the generations arriving in order', () => {
    expect(generationFor([...generations].reverse(), 6)!.activeFromGameweek).toBe(5);
  });
});

describe('scoreSeason', () => {
  const generations: PickGeneration[] = [
    { activeFromGameweek: 1, picks: side(XI_A) },
    { activeFromGameweek: 3, picks: side(XI_B) },
  ];

  it('scores each gameweek against the side that was picked for it', () => {
    // Gameweeks 1-2 belong to XI_A, 3-4 to XI_B. Only XI_A players score, so
    // a season that scored every week against the *current* side would
    // report nothing at all from gameweek 3 on — and a season that scored
    // every week against the *first* side would report full marks throughout.
    const gameweeks = [1, 2, 3, 4].map((g) => week(g, 2, XI_A));
    const season = scoreSeason(generations, gameweeks);

    // 11 starters × 2, plus the captain's extra 2, in the two XI_A weeks.
    expect(season.gameweeks.map((g) => g.points)).toEqual([24, 24, 0, 0]);
    expect(season.total).toBe(48);
    expect(season.transferCost).toBe(0);
  });

  it('skips gameweeks the manager was not playing rather than scoring them zero', () => {
    const joinedLate: PickGeneration[] = [{ activeFromGameweek: 3, picks: side(XI_A) }];
    const season = scoreSeason(joinedLate, [1, 2, 3, 4].map((g) => week(g, 1, XI_A)));
    expect(season.gameweeks.map((g) => g.gameweek)).toEqual([3, 4]);
    expect(season.total).toBe(12 + 12);
  });

  it('returns gameweeks in order however they arrive', () => {
    const shuffled = [week(3, 1, XI_A), week(1, 1, XI_A), week(2, 1, XI_A)];
    const season = scoreSeason([{ activeFromGameweek: 1, picks: side(XI_A) }], shuffled);
    expect(season.gameweeks.map((g) => g.gameweek)).toEqual([1, 2, 3]);
  });

  it('carries pending picks up to the season total', () => {
    const unpublished: ScoredGameweek = {
      gameweek: 1,
      lines: XI_A.map((playerId, i) => ({ playerId, points: i < 3 ? null : 1, minutes: 90 })),
    };
    const season = scoreSeason([{ activeFromGameweek: 1, picks: side(XI_A) }], [unpublished]);
    expect(season.pending).toBe(3);
    expect(season.gameweeks[0]!.pending).toBe(3);
    // The eight published starters score 1 each; the captain is unpublished,
    // so nothing is doubled.
    expect(season.total).toBe(8);
  });

  it('is an empty season, not an error, when nothing has been scored yet', () => {
    const season = scoreSeason([{ activeFromGameweek: 1, picks: side(XI_A) }], []);
    expect(season).toEqual({ total: 0, gameweeks: [], pending: 0, transferCost: 0 });
  });

  it('scores nothing for a manager with no picks at all', () => {
    expect(scoreSeason([], [week(1, 5)]).total).toBe(0);
    expect(scoreSeason([], [week(1, 5)]).gameweeks).toEqual([]);
  });
});

describe('scoreSeason — transfer costs', () => {
  const generations: PickGeneration[] = [{ activeFromGameweek: 1, picks: side(XI_A) }];

  it('docks the cost from the gameweek it was incurred in', () => {
    const season = scoreSeason(generations, [week(1, 2, XI_A), week(2, 2, XI_A)], {
      transferCosts: new Map([[2, 8]]),
    });
    expect(season.gameweeks.map((g) => [g.points, g.transferCost, g.net])).toEqual([
      [24, 0, 24],
      [24, 8, 16],
    ]);
    expect(season.total).toBe(40);
    expect(season.transferCost).toBe(8);
  });

  it('lets a hit take a gameweek negative rather than flooring it at zero', () => {
    // A 12-point hit on a 4-point week really is minus eight, and hiding that
    // would make the season total stop adding up.
    const season = scoreSeason(generations, [week(1, 0, [])], { transferCosts: new Map([[1, 12]]) });
    expect(season.gameweeks[0]!.net).toBe(-12);
    expect(season.total).toBe(-12);
  });

  it('ignores a cost recorded against a gameweek the manager was not playing', () => {
    const joinedLate: PickGeneration[] = [{ activeFromGameweek: 3, picks: side(XI_A) }];
    const season = scoreSeason(joinedLate, [week(1, 1, XI_A), week(3, 1, XI_A)], {
      transferCosts: new Map([[1, 20], [3, 4]]),
    });
    expect(season.gameweeks.map((g) => g.gameweek)).toEqual([3]);
    expect(season.transferCost).toBe(4);
  });

  it('never turns a stored cost into a bonus', () => {
    const season = scoreSeason(generations, [week(1, 1, XI_A)], { transferCosts: new Map([[1, -50]]) });
    expect(season.gameweeks[0]!.transferCost).toBe(0);
    expect(season.total).toBe(12);
  });
});

describe('rankLeague', () => {
  function entry(userId: string, squadName: string, total: number, latest?: number, cost = 0): LeagueEntry {
    return {
      userId,
      squadName,
      score: {
        total,
        pending: 0,
        transferCost: cost,
        gameweeks: latest === undefined
          ? []
          : [{ gameweek: 5, chip: null, points: latest + cost, transferCost: cost, net: latest, pending: 0 }],
      },
    };
  }

  it('orders by total, highest first', () => {
    const table = rankLeague([entry('a', 'Ant', 40), entry('b', 'Bee', 90), entry('c', 'Cat', 65)], null);
    expect(table.map((r) => r.squadName)).toEqual(['Bee', 'Cat', 'Ant']);
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on a tie and skips the next position', () => {
    // 1, 2, 2, 4 — the way every league table anyone has read works.
    const table = rankLeague(
      [entry('a', 'Ant', 50), entry('b', 'Bee', 90), entry('c', 'Cat', 50), entry('d', 'Dog', 10)],
      null,
    );
    expect(table.map((r) => [r.squadName, r.rank])).toEqual([
      ['Bee', 1], ['Ant', 2], ['Cat', 2], ['Dog', 4],
    ]);
  });

  it('breaks ties by name so the table does not reorder between page loads', () => {
    const one = rankLeague([entry('a', 'Zed', 50), entry('b', 'Ann', 50)], null);
    const two = rankLeague([entry('b', 'Ann', 50), entry('a', 'Zed', 50)], null);
    expect(one.map((r) => r.squadName)).toEqual(two.map((r) => r.squadName));
    expect(one.map((r) => r.squadName)).toEqual(['Ann', 'Zed']);
  });

  it('lists a manager who has not picked a side, on no points', () => {
    // Hiding them makes a league of three look like a league of two to the
    // person who is missing.
    const table = rankLeague([entry('a', 'Ant', 30), { userId: 'b', squadName: 'Bee', score: null }], null);
    expect(table.map((r) => [r.squadName, r.total])).toEqual([['Ant', 30], ['Bee', 0]]);
  });

  it('reports the gameweek net of its transfer cost, and the cost alongside', () => {
    const table = rankLeague([entry('a', 'Ant', 100, 54, 8)], 5);
    expect(table[0]!.latest).toBe(54);
    expect(table[0]!.latestCost).toBe(8);
  });

  it('reports this gameweek separately from the season', () => {
    const table = rankLeague([entry('a', 'Ant', 100, 12), entry('b', 'Bee', 80, 40)], 5);
    expect(table.map((r) => [r.squadName, r.total, r.latest])).toEqual([
      ['Ant', 100, 12],
      ['Bee', 80, 40],
    ]);
  });

  it('reports null, not zero, for a manager who was not playing that gameweek', () => {
    const table = rankLeague([entry('a', 'Ant', 100, 12), entry('b', 'Bee', 80)], 5);
    expect(table.find((r) => r.squadName === 'Bee')!.latest).toBeNull();
  });

  it('is an empty table, not an error, for a league nobody has joined', () => {
    expect(rankLeague([], 3)).toEqual([]);
  });
});

describe('scoreSeason — chips', () => {
  const generations: PickGeneration[] = [{ activeFromGameweek: 1, picks: side(XI_A) }];

  it('applies a chip only to the gameweek it was played in', () => {
    // The same side is in force all four weeks; a Bench Boost in gameweek 2
    // must not keep boosting gameweeks 3 and 4.
    const weeks = [1, 2, 3].map((g) => week(g, 1));
    const season = scoreSeason(generations, weeks, { chips: new Map([[2, 'bench-boost' as const]]) });
    // 11 starters + captain's extra = 12; boosted, 15 + 1 = 16.
    expect(season.gameweeks.map((g) => g.points)).toEqual([12, 16, 12]);
    expect(season.gameweeks.map((g) => g.chip)).toEqual([null, 'bench-boost', null]);
  });

  it('triples the captain for a Triple Captain gameweek', () => {
    const season = scoreSeason(generations, [week(1, 3, XI_A)], {
      chips: new Map([[1, 'triple-captain' as const]]),
    });
    // 11 × 3 = 33, plus two more for the captain's third helping.
    expect(season.gameweeks[0]!.points).toBe(33 + 6);
  });

  it('reports the chip alongside the score', () => {
    const season = scoreSeason(generations, [week(1, 1)], { chips: new Map([[1, 'wildcard' as const]]) });
    expect(season.gameweeks[0]!.chip).toBe('wildcard');
  });
});

describe('generationFor — Free Hit', () => {
  const withFreeHit: PickGeneration[] = [
    { activeFromGameweek: 1, picks: side(XI_A) },
    { activeFromGameweek: 5, picks: side(XI_B), freeHit: true },
  ];

  it('uses the borrowed side for its own gameweek', () => {
    expect(generationFor(withFreeHit, 5)!.activeFromGameweek).toBe(5);
  });

  it('gives the previous side back the week after', () => {
    // That is the whole chip. Letting the borrowed side persist would make a
    // Free Hit into a Wildcard — a different chip the manager did not play.
    expect(generationFor(withFreeHit, 6)!.activeFromGameweek).toBe(1);
    expect(generationFor(withFreeHit, 38)!.activeFromGameweek).toBe(1);
  });

  it('does not resurrect a free-hit side for a week before it', () => {
    expect(generationFor(withFreeHit, 4)!.activeFromGameweek).toBe(1);
  });

  it('lets a later ordinary save supersede the squad as usual', () => {
    const then: PickGeneration[] = [
      ...withFreeHit,
      { activeFromGameweek: 7, picks: side(XI_B) },
    ];
    expect(generationFor(then, 6)!.activeFromGameweek).toBe(1);
    expect(generationFor(then, 8)!.activeFromGameweek).toBe(7);
  });
});

describe('scoreSeason — a Free Hit week in a season', () => {
  it('scores the borrowed side that week and the old one after', () => {
    const generations: PickGeneration[] = [
      { activeFromGameweek: 1, picks: side(XI_A) },
      { activeFromGameweek: 2, picks: side(XI_B), freeHit: true },
    ];
    // Only XI_B players score, so the free-hit week is the only one with points.
    const weeks = [1, 2, 3].map((g) => week(g, 2, XI_B));
    const season = scoreSeason(generations, weeks, { chips: new Map([[2, 'free-hit' as const]]) });
    expect(season.gameweeks.map((g) => g.points)).toEqual([0, 24, 0]);
  });
});
