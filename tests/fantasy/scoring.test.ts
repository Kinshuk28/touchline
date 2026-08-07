import { describe, it, expect } from 'vitest';
import {
  scoreSquad,
  validateSquad,
  SQUAD_SIZE,
  STARTING_SLOTS,
  CAPTAIN_MULTIPLIER,
  type PlayerGameweek,
  type SquadPick,
} from '@/lib/fantasy/scoring';

/*
 * These tests are the readable statement of the game's rules. Each one names
 * a rule a player could argue about — who counts, who doubles, what happens
 * to a pick who never came off the bench — so that changing a rule means
 * changing a line here, deliberately, rather than discovering the change in
 * a league table three weeks later.
 */

/** Slots 1-11 starting, 12-15 bench, ids 1-15, captain 1, vice 2 by default. */
function squad(overrides: Partial<Record<number, Partial<SquadPick>>> = {}): SquadPick[] {
  return Array.from({ length: SQUAD_SIZE }, (_, i) => {
    const playerId = i + 1;
    const base: SquadPick = { playerId, slot: i + 1 };
    if (playerId === 1) base.captain = true;
    if (playerId === 2) base.viceCaptain = true;
    return { ...base, ...overrides[playerId] };
  });
}

/** Every player scores `points` off `minutes`, unless listed in `except`. */
function gameweek(
  points: number,
  except: Record<number, Partial<PlayerGameweek>> = {},
  minutes = 90,
): PlayerGameweek[] {
  return Array.from({ length: SQUAD_SIZE }, (_, i) => ({
    playerId: i + 1,
    points,
    minutes,
    ...except[i + 1],
  }));
}

describe('scoreSquad — who counts', () => {
  it('counts the eleven starters and not the four bench players', () => {
    // Starters score 5, bench players score 100. A total of 55 + a doubled
    // captain proves the bench contributed nothing at all.
    const bench = Object.fromEntries(
      [12, 13, 14, 15].map((id) => [id, { points: 100 }]),
    );
    const score = scoreSquad(squad(), gameweek(5, bench));

    expect(score.picks).toHaveLength(STARTING_SLOTS);
    expect(score.total).toBe(5 * STARTING_SLOTS + 5); // captain's extra 5
  });

  it('scores a squad with no captaincy at all as a plain sum', () => {
    const picks = squad().map(({ playerId, slot }) => ({ playerId, slot }));
    expect(scoreSquad(picks, gameweek(3)).total).toBe(3 * STARTING_SLOTS);
  });

  it('returns picks in slot order regardless of the order they were given', () => {
    const shuffled = [...squad()].reverse();
    const slots = scoreSquad(shuffled, gameweek(1)).picks.map((p) => p.slot);
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('scoreSquad — the captaincy', () => {
  it('doubles the captain', () => {
    const score = scoreSquad(squad(), gameweek(0, { 1: { points: 9 } }));
    expect(score.total).toBe(9 * CAPTAIN_MULTIPLIER);
    const captain = score.picks.find((p) => p.playerId === 1)!;
    expect(captain.captain).toBe(true);
    expect(captain.raw).toBe(9);
    expect(captain.points).toBe(18);
    expect(captain.multiplier).toBe(CAPTAIN_MULTIPLIER);
  });

  it('doubles a negative captain score too — the armband is a risk, not a bonus', () => {
    const score = scoreSquad(squad(), gameweek(0, { 1: { points: -2 } }));
    expect(score.total).toBe(-4);
  });

  it('moves the armband to the vice-captain when the captain records no minutes', () => {
    const score = scoreSquad(
      squad(),
      gameweek(0, { 1: { points: 0, minutes: 0 }, 2: { points: 7 } }),
    );
    const vice = score.picks.find((p) => p.playerId === 2)!;
    expect(vice.captain).toBe(true);
    expect(vice.points).toBe(14);
    // And the captain, having been replaced from the bench, is not in the XI.
    expect(score.picks.some((p) => p.playerId === 1)).toBe(false);
  });

  it('leaves the armband with the captain when they played, however badly', () => {
    const score = scoreSquad(
      squad(),
      gameweek(0, { 1: { points: -1, minutes: 4 }, 2: { points: 12 } }),
    );
    expect(score.picks.find((p) => p.playerId === 1)!.captain).toBe(true);
    expect(score.picks.find((p) => p.playerId === 2)!.captain).toBe(false);
    expect(score.total).toBe(-2 + 12);
  });

  it('doubles nobody when neither the captain nor the vice-captain appeared', () => {
    // Both blank, and only two bench players are available to replace them,
    // so the captaincy has nowhere to go. It stays with the captain, who is
    // no longer on the field, and doubles nothing.
    const score = scoreSquad(
      squad(),
      gameweek(4, {
        1: { points: 0, minutes: 0 },
        2: { points: 0, minutes: 0 },
        12: { points: 6 },
        13: { points: 6 },
      }),
    );
    expect(score.picks.every((p) => p.multiplier === 1)).toBe(true);
    expect(score.total).toBe(4 * 9 + 6 + 6);
  });

  it('doubles a bench captain only once they are subbed on', () => {
    // Player 12 is captain, on the bench. Nobody blanks, so nobody is
    // subbed on, and the captaincy pays nothing.
    const benched = scoreSquad(
      squad({ 1: { captain: false }, 12: { captain: true } }),
      gameweek(2, { 12: { points: 50 } }),
    );
    expect(benched.picks.every((p) => p.multiplier === 1)).toBe(true);
    expect(benched.total).toBe(2 * STARTING_SLOTS);

    // Same squad, but a starter blanks: 12 comes on and the armband is live.
    const subbedOn = scoreSquad(
      squad({ 1: { captain: false }, 12: { captain: true } }),
      gameweek(2, { 5: { points: 0, minutes: 0 }, 12: { points: 50 } }),
    );
    expect(subbedOn.total).toBe(2 * 10 + 50 * CAPTAIN_MULTIPLIER);
  });
});

describe('scoreSquad — auto-substitutions', () => {
  it('replaces a blank starter with the first bench player who appeared', () => {
    const score = scoreSquad(
      squad(),
      gameweek(1, { 5: { points: 0, minutes: 0 }, 12: { points: 8 } }),
    );
    const replacement = score.picks.find((p) => p.playerId === 12)!;
    expect(replacement.autoSubbed).toBe(true);
    // The substitute plays in the starter's slot, so eleven picks in order.
    expect(replacement.slot).toBe(5);
    expect(score.picks).toHaveLength(STARTING_SLOTS);
    expect(score.total).toBe(1 * 10 + 8 + 1); // ten starters, the sub, captain's extra
  });

  it('skips bench players who did not appear, in bench order', () => {
    const score = scoreSquad(
      squad(),
      gameweek(1, {
        5: { points: 0, minutes: 0 },
        12: { points: 0, minutes: 0 },
        13: { points: 0, minutes: 0 },
        14: { points: 20 },
      }),
    );
    expect(score.picks.find((p) => p.playerId === 14)!.autoSubbed).toBe(true);
    expect(score.picks.some((p) => p.playerId === 12 || p.playerId === 13)).toBe(false);
  });

  it('never uses the same bench player for two blanks', () => {
    const score = scoreSquad(
      squad(),
      gameweek(1, {
        4: { points: 0, minutes: 0 },
        5: { points: 0, minutes: 0 },
        12: { points: 6 },
        13: { points: 7 },
      }),
    );
    const subs = score.picks.filter((p) => p.autoSubbed).map((p) => p.playerId);
    expect(subs).toEqual([12, 13]);
    expect(score.total).toBe(1 * 9 + 6 + 7 + 1);
  });

  it('leaves a blank starter in place when no bench player appeared', () => {
    const bench = Object.fromEntries(
      [12, 13, 14, 15].map((id) => [id, { points: 0, minutes: 0 }]),
    );
    const score = scoreSquad(
      squad(),
      gameweek(1, { ...bench, 5: { points: 0, minutes: 0 } }),
    );
    const blank = score.picks.find((p) => p.playerId === 5)!;
    expect(blank.autoSubbed).toBe(false);
    expect(blank.points).toBe(0);
    expect(score.picks).toHaveLength(STARTING_SLOTS);
  });

  it('does not sub off a starter who played but scored nothing', () => {
    const score = scoreSquad(
      squad(),
      gameweek(1, { 5: { points: 0, minutes: 12 }, 12: { points: 30 } }),
    );
    expect(score.picks.find((p) => p.playerId === 5)).toBeDefined();
    expect(score.picks.some((p) => p.autoSubbed)).toBe(false);
  });
});

describe('scoreSquad — unpublished scores are pending, never zero', () => {
  it('counts a null score as pending and contributes nothing to the total', () => {
    const score = scoreSquad(
      squad(),
      gameweek(2, { 7: { points: null, minutes: 61 } }),
    );
    expect(score.pending).toBe(1);
    const unpublished = score.picks.find((p) => p.playerId === 7)!;
    expect(unpublished.raw).toBeNull();
    expect(unpublished.points).toBe(0);
    expect(score.total).toBe(2 * 10 + 2); // ten published starters plus the captain's extra
  });

  it('counts a pick with no gameweek line at all as pending, not zero', () => {
    const lines = gameweek(2).filter((l) => l.playerId !== 9);
    const score = scoreSquad(squad(), lines);
    expect(score.pending).toBe(1);
    expect(score.picks.find((p) => p.playerId === 9)!.raw).toBeNull();
  });

  it('does not auto-sub a starter whose minutes are merely unpublished', () => {
    // A gameweek still being scored must not trigger a substitution that a
    // completed one would undo. Unknown is not "did not play".
    const score = scoreSquad(
      squad(),
      gameweek(2, { 5: { points: null, minutes: null }, 12: { points: 9 } }),
    );
    expect(score.picks.some((p) => p.autoSubbed)).toBe(false);
    expect(score.picks.find((p) => p.playerId === 5)).toBeDefined();
    expect(score.pending).toBe(1);
  });

  it('reports every starter pending when FPL has published nothing', () => {
    const score = scoreSquad(squad(), []);
    expect(score.pending).toBe(STARTING_SLOTS);
    expect(score.total).toBe(0);
  });
});

describe('validateSquad', () => {
  it('accepts a well-formed squad', () => {
    expect(validateSquad(squad())).toEqual([]);
  });

  it('accepts a squad with no vice-captain', () => {
    expect(validateSquad(squad({ 2: { viceCaptain: false } }))).toEqual([]);
  });

  it('rejects the wrong number of players', () => {
    expect(validateSquad(squad().slice(0, 14)).join(' ')).toMatch(/15 players/);
  });

  it('rejects two picks in one slot', () => {
    expect(validateSquad(squad({ 3: { slot: 4 } })).join(' ')).toMatch(/share a slot/);
  });

  it('rejects a slot outside 1-15', () => {
    // Slot 0 also frees slot 1, so this reports the range error alongside
    // whatever else it breaks; the range message is the one being asserted.
    expect(validateSquad(squad({ 1: { slot: 0, captain: true } })).join(' ')).toMatch(/between 1 and 15/);
    expect(validateSquad(squad({ 1: { slot: 1.5, captain: true } })).join(' ')).toMatch(/between 1 and 15/);
  });

  it('rejects the same player picked twice', () => {
    expect(validateSquad(squad({ 3: { playerId: 4 } })).join(' ')).toMatch(/picked twice/);
  });

  it('rejects no captain and two captains alike', () => {
    expect(validateSquad(squad({ 1: { captain: false } })).join(' ')).toMatch(/Exactly one captain, not 0/);
    expect(validateSquad(squad({ 3: { captain: true } })).join(' ')).toMatch(/Exactly one captain, not 2/);
  });

  it('rejects two vice-captains', () => {
    expect(validateSquad(squad({ 3: { viceCaptain: true } })).join(' ')).toMatch(/At most one vice-captain/);
  });

  it('rejects one player holding both armbands', () => {
    const picks = squad({ 2: { viceCaptain: false }, 1: { captain: true, viceCaptain: true } });
    expect(validateSquad(picks).join(' ')).toMatch(/cannot also be vice-captain/);
  });

  it('reports every problem at once rather than the first', () => {
    const picks = squad({ 1: { captain: false }, 2: { viceCaptain: false } }).slice(0, 13);
    expect(validateSquad(picks).length).toBeGreaterThan(1);
  });
});
