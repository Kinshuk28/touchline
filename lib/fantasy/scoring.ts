/**
 * Touchline Fantasy scoring — the rules *this* game defines.
 *
 * WHAT THIS DOES NOT DO. It does not compute a player's points. FPL already
 * publishes those per gameweek (`event/{id}/live` → `stats.total_points`),
 * their rules change between seasons — defensive contribution points
 * arrived in 2025-26 — and a reimplementation here would be a second source
 * of truth silently drifting from the first. Player points are ingested as
 * published.
 *
 * WHAT IT DOES. Turn eleven published player scores into one squad score:
 * who counts, who doubles, and what happens when a pick didn't play. Those
 * are our rules, they are the game, and they belong in one readable place.
 *
 * Pure — no database, no network, no clock. Every rule below is a line you
 * can point at in tests/fantasy/scoring.test.ts.
 */

/** A player's published gameweek score, as ingested. `null` means FPL has not published one — not zero. */
export interface PlayerGameweek {
  playerId: number;
  points: number | null;
  /** Minutes played, used only to decide whether a pick "appeared". `null` when unpublished. */
  minutes: number | null;
}

export interface SquadPick {
  playerId: number;
  /** 1-11 start, 12-15 bench in bench order. */
  slot: number;
  /** Exactly one pick per squad carries this. Their points double. */
  captain?: boolean;
  /** Takes the captaincy if the captain records no minutes. At most one. */
  viceCaptain?: boolean;
}

export const STARTING_SLOTS = 11;
export const SQUAD_SIZE = 15;
export const CAPTAIN_MULTIPLIER = 2;

export interface ScoredPick {
  playerId: number;
  slot: number;
  /** What the player scored, before any multiplier. `null` when FPL published nothing. */
  raw: number | null;
  /** What this pick contributed to the squad total. */
  points: number;
  multiplier: number;
  /** Came on from the bench for a starter who recorded no minutes. */
  autoSubbed: boolean;
  captain: boolean;
}

export interface SquadScore {
  total: number;
  picks: ScoredPick[];
  /** Picks whose points FPL has not published yet — the reason a total can still move. */
  pending: number;
}

/**
 * Whether a pick took the field — with three answers, not two.
 *
 * `null` minutes (or no line at all) means FPL has published nothing, which
 * is *not* the same as zero minutes, and the difference decides whether a
 * substitution happens. Collapsing the two would make a gameweek still
 * being scored trigger auto-subs that the finished gameweek then undoes,
 * and a manager watching a live total would see players appear and vanish.
 *
 * So the two predicates below are deliberately not each other's negation:
 * both are false while a player is unknown. Nothing acts on unknown.
 * Callers score a gameweek once it is final; scoring one mid-flight gives a
 * provisional answer, and `pending` says how provisional.
 */
function playedFor(line: PlayerGameweek | undefined): boolean {
  return line !== undefined && line.minutes !== null && line.minutes > 0;
}

/** Known to have played no part — published minutes of exactly zero. */
function blanked(line: PlayerGameweek | undefined): boolean {
  return line !== undefined && line.minutes === 0;
}

/**
 * One squad's score for one gameweek.
 *
 * The rules, in the order they apply:
 *
 * 1. **Starters count, the bench does not** — except that a starter who
 *    recorded no minutes is replaced by the first bench player who did, in
 *    bench order. This is FPL's own auto-sub behaviour and the one piece of
 *    their logic worth reproducing, because without it a squad is punished
 *    for a manager's teamsheet decision made after the deadline.
 * 2. **The captain doubles.** If the captain recorded no minutes, the
 *    vice-captain takes it instead — again FPL's rule, and for the same
 *    reason.
 * 3. **An unpublished score contributes nothing and is counted as
 *    pending.** It is not zero: a total shown while a gameweek is still
 *    being scored is provisional, and `pending` is what lets a page say so
 *    instead of presenting an incomplete sum as final.
 *
 * Picks the caller supplies with no matching gameweek line are treated the
 * same way — unknown, not zero.
 */
export function scoreSquad(picks: readonly SquadPick[], gameweek: readonly PlayerGameweek[]): SquadScore {
  const lineByPlayer = new Map(gameweek.map((line) => [line.playerId, line]));
  const bySlot = [...picks].sort((a, b) => a.slot - b.slot);

  const starters = bySlot.filter((p) => p.slot <= STARTING_SLOTS);
  const bench = bySlot.filter((p) => p.slot > STARTING_SLOTS);

  // Auto-subs: each starter *known* to have blanked draws the next bench
  // player *known* to have played. A starter whose minutes are merely
  // unpublished keeps their place — see `playedFor`/`blanked` above.
  const usedBench = new Set<number>();
  const active: Array<{ pick: SquadPick; autoSubbed: boolean }> = starters.map((pick) => {
    if (!blanked(lineByPlayer.get(pick.playerId))) return { pick, autoSubbed: false };
    const replacement = bench.find(
      (b) => !usedBench.has(b.playerId) && playedFor(lineByPlayer.get(b.playerId)),
    );
    if (!replacement) return { pick, autoSubbed: false };
    usedBench.add(replacement.playerId);
    // The substitute plays in the starter's slot, so the squad keeps eleven
    // scoring picks and the slot order stays meaningful for display.
    return { pick: { ...replacement, slot: pick.slot }, autoSubbed: true };
  });

  // The captaincy moves only when the armband's owner is known to have
  // blanked *and* the vice-captain is known to have played. Either one
  // unpublished and it stays put: handing the armband over on a guess and
  // taking it back an hour later is worse than a provisional total the
  // `pending` count already flags.
  const captain = picks.find((p) => p.captain);
  const viceCaptain = picks.find((p) => p.viceCaptain);
  const captainBlanked = captain !== undefined && blanked(lineByPlayer.get(captain.playerId));
  const effectiveCaptainId =
    captainBlanked && viceCaptain !== undefined && playedFor(lineByPlayer.get(viceCaptain.playerId))
      ? viceCaptain.playerId
      : captain?.playerId;

  let total = 0;
  let pending = 0;
  const scored: ScoredPick[] = active.map(({ pick, autoSubbed }) => {
    const raw = lineByPlayer.get(pick.playerId)?.points ?? null;
    const isCaptain = pick.playerId === effectiveCaptainId;
    const multiplier = isCaptain ? CAPTAIN_MULTIPLIER : 1;
    if (raw === null) pending += 1;
    const points = raw === null ? 0 : raw * multiplier;
    total += points;
    return { playerId: pick.playerId, slot: pick.slot, raw, points, multiplier, autoSubbed, captain: isCaptain };
  });

  return { total, picks: scored, pending };
}

/**
 * Whether a set of picks is a legal squad, and why not when it isn't.
 *
 * Deliberately structural only — slots, captaincy, duplicates. Positional
 * shape (one keeper, at least three defenders) and club limits need player
 * metadata this function is not given; they belong in the picker, against
 * the real squad list, where the error can point at a player.
 */
export function validateSquad(picks: readonly SquadPick[]): string[] {
  const errors: string[] = [];

  if (picks.length !== SQUAD_SIZE) errors.push(`A squad is ${SQUAD_SIZE} players; this one has ${picks.length}.`);

  const slots = picks.map((p) => p.slot);
  if (new Set(slots).size !== slots.length) errors.push('Two picks share a slot.');
  if (slots.some((s) => !Number.isInteger(s) || s < 1 || s > SQUAD_SIZE)) {
    errors.push(`Every slot must be between 1 and ${SQUAD_SIZE}.`);
  }

  const ids = picks.map((p) => p.playerId);
  if (new Set(ids).size !== ids.length) errors.push('The same player is picked twice.');

  const captains = picks.filter((p) => p.captain);
  if (captains.length !== 1) errors.push(`Exactly one captain, not ${captains.length}.`);

  const vices = picks.filter((p) => p.viceCaptain);
  if (vices.length > 1) errors.push(`At most one vice-captain, not ${vices.length}.`);
  if (vices.length === 1 && captains.length === 1 && vices[0]!.playerId === captains[0]!.playerId) {
    errors.push('The captain cannot also be vice-captain.');
  }

  return errors;
}
