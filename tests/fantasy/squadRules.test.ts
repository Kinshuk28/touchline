import { describe, it, expect } from 'vitest';
import {
  canStillCompleteFormation,
  selectionErrors,
  lineupErrors,
  assignSlots,
  canSwap,
  isLegalFormation,
  formationName,
  countByPosition,
  clubCounts,
  totalCost,
  formatPrice,
  SQUAD_SHAPE,
  BUDGET_TENTHS,
  MAX_PER_CLUB,
  type FantasyPosition,
  type PickablePlayer,
} from '@/lib/fantasy/squadRules';

let nextId = 1;

function player(position: FantasyPosition, over: Partial<PickablePlayer> = {}): PickablePlayer {
  return { playerId: nextId++, position, priceTenths: 50, teamId: 1, ...over };
}

/** A legal 15: 2/5/5/3, three clubs' worth of players, £75.0m. */
function legalSquad(over: Partial<PickablePlayer> = {}): PickablePlayer[] {
  nextId = 1;
  const out: PickablePlayer[] = [];
  let club = 0;
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
    for (let i = 0; i < SQUAD_SHAPE[pos]; i += 1) {
      // Rotate clubs so no club holds more than three.
      out.push(player(pos, { teamId: Math.floor(club / MAX_PER_CLUB) + 1, ...over }));
      club += 1;
    }
  }
  return out;
}

function starting(squad: PickablePlayer[], formation: [number, number, number]): PickablePlayer[] {
  const [d, m, f] = formation;
  const of = (pos: FantasyPosition) => squad.filter((p) => p.position === pos);
  return [...of('GK').slice(0, 1), ...of('DEF').slice(0, d), ...of('MID').slice(0, m), ...of('FWD').slice(0, f)];
}

describe('formatPrice', () => {
  it('reads FPL tenths as pounds millions', () => {
    expect(formatPrice(125)).toBe('£12.5m');
    expect(formatPrice(1000)).toBe('£100.0m');
    expect(formatPrice(40)).toBe('£4.0m');
  });
});

describe('selectionErrors', () => {
  it('accepts a legal squad', () => {
    expect(selectionErrors(legalSquad())).toEqual([]);
  });

  it('names the shortfall in each position rather than just the total', () => {
    const short = legalSquad().filter((p) => p.position !== 'FWD');
    const errors = selectionErrors(short).join(' ');
    expect(errors).toMatch(/Forwards: 0 of 3/);
    expect(errors).toMatch(/15 players; you have 12/);
  });

  it('catches a wrong shape that still totals fifteen', () => {
    // Six midfielders and four defenders — the count is right, the squad is not.
    const squad = legalSquad();
    const swapped = squad.map((p, i) => (i === 2 ? { ...p, position: 'MID' as const } : p));
    const errors = selectionErrors(swapped).join(' ');
    expect(errors).toMatch(/Defenders: 4 of 5/);
    expect(errors).toMatch(/Midfielders: 6 of 5/);
    expect(errors).not.toMatch(/15 players/);
  });

  it('reports the exact amount a squad is over budget', () => {
    // 15 × £6.8m = £102.0m, £2.0m over.
    const rich = legalSquad({ priceTenths: 68 });
    expect(totalCost(rich)).toBe(1020);
    expect(selectionErrors(rich).join(' ')).toMatch(/Over budget by £2\.0m/);
  });

  it('accepts a squad that spends the budget exactly', () => {
    const exact = legalSquad().map((p, i) => ({ ...p, priceTenths: i === 0 ? BUDGET_TENTHS - 14 * 50 : 50 }));
    expect(totalCost(exact)).toBe(BUDGET_TENTHS);
    expect(selectionErrors(exact)).toEqual([]);
  });

  it('enforces the three-per-club limit', () => {
    const oneClub = legalSquad({ teamId: 7 });
    expect(selectionErrors(oneClub).join(' ')).toMatch(/More than 3 players from club 7 \(15\)/);
  });

  it('allows exactly three from a club', () => {
    const squad = legalSquad();
    expect([...clubCounts(squad).values()].every((n) => n <= MAX_PER_CLUB)).toBe(true);
    expect(selectionErrors(squad)).toEqual([]);
  });

  it('does not group players with unknown clubs into one imaginary club', () => {
    // Four players FPL added since the last squads run. Counting them
    // together would block a legal squad with a rule nobody could see.
    const squad = legalSquad().map((p, i) => (i < 4 ? { ...p, teamId: null } : p));
    expect(clubCounts(squad).has(0)).toBe(false);
    expect(selectionErrors(squad)).toEqual([]);
  });

  it('catches the same player picked twice', () => {
    const squad = legalSquad();
    const dupe = [...squad.slice(0, 14), { ...squad[0]!, position: squad[14]!.position }];
    expect(selectionErrors(dupe).join(' ')).toMatch(/picked twice/);
  });

  it('reports every problem at once', () => {
    const bad = legalSquad({ priceTenths: 90, teamId: 3 }).slice(0, 13);
    expect(selectionErrors(bad).length).toBeGreaterThan(2);
  });
});

describe('isLegalFormation', () => {
  const shape = (gk: number, d: number, m: number, f: number) => ({ GK: gk, DEF: d, MID: m, FWD: f });

  it('accepts the formations people actually play', () => {
    for (const [d, m, f] of [[4, 4, 2], [4, 3, 3], [3, 5, 2], [3, 4, 3], [5, 3, 2], [5, 4, 1], [4, 5, 1]]) {
      expect(isLegalFormation(shape(1, d!, m!, f!))).toBe(true);
    }
  });

  it('rejects a formation with no forward or too few defenders', () => {
    expect(isLegalFormation(shape(1, 5, 5, 0))).toBe(false);
    expect(isLegalFormation(shape(1, 2, 5, 3))).toBe(false);
  });

  it('rejects two keepers and no keeper alike', () => {
    expect(isLegalFormation(shape(2, 4, 3, 2))).toBe(false);
    expect(isLegalFormation(shape(0, 5, 4, 2))).toBe(false);
  });

  it('rejects anything that is not eleven players', () => {
    expect(isLegalFormation(shape(1, 4, 4, 1))).toBe(false);
    expect(isLegalFormation(shape(1, 5, 5, 3))).toBe(false);
  });

  it('names a formation the way a manager writes it', () => {
    expect(formationName(shape(1, 3, 5, 2))).toBe('3-5-2');
  });
});

describe('canStillCompleteFormation', () => {
  const shape = (gk: number, d: number, m: number, f: number) => ({ GK: gk, DEF: d, MID: m, FWD: f });

  it('accepts an empty and a completed eleven alike', () => {
    expect(canStillCompleteFormation(shape(0, 0, 0, 0))).toBe(true);
    expect(canStillCompleteFormation(shape(1, 4, 4, 2))).toBe(true);
  });

  it('accepts a part-built eleven with room for what is still missing', () => {
    // One keeper and five defenders is not a legal formation, but it is a
    // perfectly fine five picks into the job.
    expect(canStillCompleteFormation(shape(1, 5, 0, 0))).toBe(true);
  });

  it('rejects a lineup that has left no room for a forward', () => {
    // The 5-5-0 the picker used to build: every position inside its own
    // maximum, eleven slots used, and no legal formation reachable.
    expect(canStillCompleteFormation(shape(1, 5, 5, 0))).toBe(false);
  });

  it('rejects a full eleven that is still short of a minimum', () => {
    // Eleven picked, two at the back: no slot left to owe a third defender.
    expect(canStillCompleteFormation(shape(1, 2, 5, 3))).toBe(false);
    // One fewer forward leaves exactly the slot that shortfall needs.
    expect(canStillCompleteFormation(shape(1, 2, 5, 2))).toBe(true);
  });

  it('rejects exceeding a position maximum at any stage', () => {
    expect(canStillCompleteFormation(shape(2, 0, 0, 0))).toBe(false);
    expect(canStillCompleteFormation(shape(1, 6, 0, 0))).toBe(false);
  });

  it('rejects more than eleven', () => {
    expect(canStillCompleteFormation(shape(1, 5, 5, 1))).toBe(false);
  });
});

describe('lineupErrors', () => {
  const squad = legalSquad();
  const xi = starting(squad, [4, 4, 2]);
  const captainId = xi[5]!.playerId;
  const viceCaptainId = xi[6]!.playerId;

  it('accepts a legal lineup', () => {
    expect(lineupErrors(xi, { captainId, viceCaptainId })).toEqual([]);
  });

  it('accepts a lineup with no vice-captain', () => {
    expect(lineupErrors(xi, { captainId, viceCaptainId: null })).toEqual([]);
  });

  it('explains an illegal formation in football’s own terms', () => {
    const twoAtTheBack = starting(squad, [2, 5, 3]);
    expect(lineupErrors(twoAtTheBack, { captainId, viceCaptainId }).join(' '))
      .toMatch(/2-5-3 is not a legal formation/);
  });

  it('does not complain about formation when the count is simply wrong', () => {
    const ten = xi.slice(0, 10);
    const errors = lineupErrors(ten, { captainId, viceCaptainId }).join(' ');
    expect(errors).toMatch(/Start 11 players; you have 10/);
    expect(errors).not.toMatch(/not a legal formation/);
  });

  it('requires a captain, and requires them to be starting', () => {
    expect(lineupErrors(xi, { captainId: null, viceCaptainId }).join(' ')).toMatch(/Pick a captain/);
    const benched = squad.find((p) => !xi.includes(p))!.playerId;
    expect(lineupErrors(xi, { captainId: benched, viceCaptainId }).join(' '))
      .toMatch(/captain must be in the starting eleven/);
  });

  it('rejects a benched vice-captain and a doubled-up armband', () => {
    const benched = squad.find((p) => !xi.includes(p))!.playerId;
    expect(lineupErrors(xi, { captainId, viceCaptainId: benched }).join(' '))
      .toMatch(/vice-captain must be in the starting eleven/);
    expect(lineupErrors(xi, { captainId, viceCaptainId: captainId }).join(' '))
      .toMatch(/cannot also be vice-captain/);
  });
});

describe('assignSlots', () => {
  const squad = legalSquad();
  const xi = starting(squad, [4, 4, 2]);
  const bench = squad.filter((p) => !xi.includes(p));

  it('numbers the eleven 1-11 and the bench 12-15', () => {
    const slots = assignSlots(xi, bench).map((s) => s.slot);
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('orders the eleven keeper first, then out from the back', () => {
    const byId = new Map(squad.map((p) => [p.playerId, p]));
    const positions = assignSlots(xi, bench)
      .slice(0, 11)
      .map((s) => byId.get(s.playerId)!.position);
    expect(positions).toEqual(['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD']);
  });

  it('puts the reserve keeper at slot 12, whatever order the bench arrived in', () => {
    const byId = new Map(squad.map((p) => [p.playerId, p]));
    const keeperLast = [...bench.filter((p) => p.position !== 'GK'), ...bench.filter((p) => p.position === 'GK')];
    const slot12 = assignSlots(xi, keeperLast).find((s) => s.slot === 12)!;
    expect(byId.get(slot12.playerId)!.position).toBe('GK');
  });

  it('keeps the outfield bench in the order it was given — that order is the substitution order', () => {
    const outfield = bench.filter((p) => p.position !== 'GK');
    const reversed = [...bench.filter((p) => p.position === 'GK'), ...[...outfield].reverse()];
    const slots = assignSlots(xi, reversed);
    expect(slots.slice(12).map((s) => s.playerId)).toEqual([...outfield].reverse().map((p) => p.playerId));
  });

  it('gives every player exactly one slot', () => {
    const slots = assignSlots(xi, bench);
    expect(new Set(slots.map((s) => s.playerId)).size).toBe(15);
    expect(new Set(slots.map((s) => s.slot)).size).toBe(15);
  });
});

describe('canSwap', () => {
  const squad = legalSquad();
  const xi = starting(squad, [4, 4, 2]);
  const bench = squad.filter((p) => !xi.includes(p));
  const find = (pool: PickablePlayer[], pos: FantasyPosition) => pool.find((p) => p.position === pos)!;

  it('always allows a like-for-like swap', () => {
    expect(canSwap(xi, find(xi, 'GK'), find(bench, 'GK'))).toBe(true);
    expect(canSwap(xi, find(xi, 'DEF'), find(bench, 'DEF'))).toBe(true);
  });

  it('allows a cross-position swap that leaves a legal formation', () => {
    // 4-4-2 → 3-4-3: still three at the back.
    expect(canSwap(xi, find(xi, 'DEF'), find(bench, 'FWD'))).toBe(true);
  });

  it('refuses a swap that would break the formation', () => {
    // 4-4-2 with only one keeper: a keeper cannot come on for an outfielder.
    expect(canSwap(xi, find(xi, 'DEF'), find(bench, 'GK'))).toBe(false);
    // And 4-4-2 → 4-4-1 with a fifth defender is one forward short.
    const threeAtTheBack = starting(squad, [3, 4, 3]);
    expect(canSwap(threeAtTheBack, find(threeAtTheBack, 'DEF'), find(bench, 'MID'))).toBe(false);
  });
});

describe('countByPosition', () => {
  it('counts an empty selection as zeroes rather than missing keys', () => {
    expect(countByPosition([])).toEqual({ GK: 0, DEF: 0, MID: 0, FWD: 0 });
  });
});
