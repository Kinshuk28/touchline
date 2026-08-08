'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { trackServerEvent } from '@/lib/site/analytics';
import { getPlayerPool, getFantasyCalendar, getFantasySeason } from '@/lib/site/queries/fantasy';
import { openGameweek } from '@/lib/fantasy/gameweekWindow';
import {
  saveSquad,
  getSquadId,
  getSquadForGameweek,
  getTransferHistory,
  getChipsPlayed,
  getChipForGameweek,
} from '@/lib/fantasy/squadStore';
import {
  transfersBetween,
  transferAllowance,
  transferCost,
  effectiveAllowance,
} from '@/lib/fantasy/transfers';
import { chipErrors, CHIPS, CHIP_LABELS, type Chip } from '@/lib/fantasy/chips';
import {
  assignSlots,
  lineupErrors,
  selectionErrors,
  type PickablePlayer,
} from '@/lib/fantasy/squadRules';

/**
 * Saving a squad.
 *
 * THE CLIENT'S VALIDATION IS A COURTESY. The picker greys out illegal moves
 * so a manager learns the rules while clicking, but it holds the prices, the
 * positions and the club of every player in browser memory, and anybody can
 * post whatever they like to this action. So every rule is checked again
 * here, against a pool read from the database in this request — not against
 * anything the client sent. The client sends fifteen player ids, a lineup
 * and two armbands, and nothing else is trusted.
 *
 * The rules themselves are the same functions the picker uses
 * (`lib/fantasy/squadRules.ts`), so the two can never drift into disagreeing
 * about what is legal — which would show up as a picker that refuses to save
 * a squad it just told you was fine.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'Give your squad a name.').max(40, 'Squad names are 40 characters or fewer.'),
  starters: z.array(z.number().int().positive()).length(11, 'Start exactly eleven players.'),
  // Order matters: the bench is a substitution order, not a set.
  bench: z.array(z.number().int().positive()).length(4, 'Name four substitutes.'),
  captainId: z.number().int().positive({ message: 'Pick a captain.' }),
  viceCaptainId: z.number().int().positive().nullable(),
  // Validated against what this squad has already played further down; the
  // enum here only rejects a value that is not a chip at all.
  chip: z.enum(CHIPS as unknown as [Chip, ...Chip[]]).nullable().default(null),
});

export interface SaveState {
  status: 'idle' | 'saved' | 'error';
  /** Everything wrong at once, so a manager fixes one squad rather than discovering five refusals. */
  errors: string[];
  message: string;
}

/**
 * A squad is valued at what it cost, not at today's list price.
 *
 * FPL prices move all season, so charging a stored squad today's prices would
 * push a manager whose players *improved* over the budget and force them to
 * sell one — being punished for picking well. Instead each pick records what
 * it cost when bought (supabase/migrations/0010), a player already owned keeps
 * that price, and only a new arrival pays the current one.
 *
 * A pick with no recorded price is one written before 0010; it falls back to
 * the current price, which is the only honest answer available.
 */
function priceFor(
  playerId: number,
  owned: ReadonlyMap<number, number | null>,
  pool: ReadonlyMap<number, PickablePlayer>,
): number {
  const paid = owned.get(playerId);
  return paid ?? pool.get(playerId)?.priceTenths ?? 0;
}

export async function saveSquadAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) {
    return { status: 'error', errors: [], message: 'Your session expired. Sign in again and your picks are still here.' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('squad') ?? ''));
  } catch {
    return { status: 'error', errors: [], message: 'Could not read that squad.' };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { status: 'error', errors: parsed.error.issues.map((i) => i.message), message: 'That squad is not legal yet.' };
  }
  const { name, starters, bench, captainId, viceCaptainId, chip } = parsed.data;

  const season = await getFantasySeason();
  if (season === null) {
    return { status: 'error', errors: [], message: 'The season is not set up yet.' };
  }

  // The pool as the database has it. Prices move during a season, so a squad
  // that was affordable when the page loaded may not be when it is saved —
  // and that is the correct answer, not a stale one from the client.
  const pool = await getPlayerPool(season);
  const byId = new Map<number, PickablePlayer>(
    pool.map((p) => [p.playerId, { playerId: p.playerId, position: p.position, priceTenths: p.priceTenths, teamId: p.teamId }]),
  );

  const ids = [...starters, ...bench];
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      status: 'error',
      errors: [],
      message: `${unknown.length} of those players are not in this season's game.`,
    };
  }

  // Which gameweek this takes effect from. Once a deadline passes the picks
  // for that week are settled, so a save becomes the *next* week's side —
  // see lib/fantasy/gameweekWindow.ts for why that rule is the whole game.
  const calendar = await getFantasyCalendar(season);
  const gameweek = openGameweek(calendar);
  if (gameweek === null) {
    return { status: 'error', errors: [], message: 'The season is over — there is no gameweek left to pick for.' };
  }

  // Two different sides matter here, and conflating them is a real bug.
  //
  // `current` is what the picker was editing — the newest generation at or
  // before the open gameweek, which after one save *is* this gameweek's side.
  // It carries the purchase prices.
  //
  // `locked` is the side that finished the previous gameweek, and it is what
  // transfers are counted against. Diffing against `current` instead would
  // let a manager save three changes, then three more, and be charged for
  // three: each save would compare against the one before it rather than
  // against the side they actually started the week with. Counting from
  // `locked` every time is also what makes changing your mind before the
  // deadline free, which is the behaviour anyone would expect.
  const squadId = await getSquadId(session.accessToken, session.userId, season);
  const [current, locked, chipsPlayed, previousChip] = squadId === null
    ? [null, null, [], null]
    : await Promise.all([
      getSquadForGameweek(session.accessToken, session.userId, season, gameweek),
      getSquadForGameweek(session.accessToken, session.userId, season, gameweek - 1),
      getChipsPlayed(session.accessToken, squadId),
      gameweek > 1 ? getChipForGameweek(session.accessToken, squadId, gameweek - 1) : Promise.resolve(null),
    ]);

  // A chip is spent, so whether it may be played is checked here and not
  // taken from the client at all.
  const chipProblems = chipErrors(chip, chipsPlayed, gameweek);
  if (chipProblems.length > 0) {
    return { status: 'error', errors: chipProblems, message: 'That chip is not available.' };
  }

  // A Free Hit side lasts one gameweek, so the week after one, the baseline
  // for counting transfers is the side from *before* the Free Hit — which is
  // what `getSquadForGameweek` returns for `gameweek - 2`. Without this a
  // manager would be billed for undoing a free hit they never chose to keep.
  const baseline = previousChip === 'free-hit' && squadId !== null && gameweek > 2
    ? await getSquadForGameweek(session.accessToken, session.userId, season, gameweek - 2)
    : locked;
  const previousIds = baseline?.picks.map((p) => p.playerId) ?? [];
  const paidFor = new Map<number, number | null>(
    (current?.picks ?? []).map((p) => [p.playerId, p.priceTenths]),
  );

  // Prices: a player already in the squad keeps what they cost; a new arrival
  // pays today's price. See `priceFor`.
  const priced = new Map<number, PickablePlayer>(
    ids.map((id) => {
      const player = byId.get(id)!;
      return [id, { ...player, priceTenths: priceFor(id, paidFor, byId) }];
    }),
  );
  const selected = ids.map((id) => priced.get(id)!);
  const startingPlayers = starters.map((id) => priced.get(id)!);
  const benchPlayers = bench.map((id) => priced.get(id)!);

  const errors = [
    ...selectionErrors(selected),
    ...lineupErrors(startingPlayers, { captainId, viceCaptainId }),
  ];
  if (errors.length > 0) {
    return { status: 'error', errors: namedClubs(errors, pool), message: 'That squad is not legal yet.' };
  }

  const history = squadId === null ? [] : await getTransferHistory(session.accessToken, squadId);
  const diff = transfersBetween(previousIds, ids);
  // A Wildcard or Free Hit makes this week's transfers free — expressed as an
  // unlimited allowance so nothing downstream has to know about chips.
  const allowance = effectiveAllowance(transferAllowance(history, gameweek), chip);
  const cost = transferCost(diff.count, allowance);

  const slots = assignSlots(startingPlayers, benchPlayers);
  const picks = slots.map(({ playerId, slot }) => ({
    playerId,
    slot,
    isCaptain: playerId === captainId,
    isViceCaptain: playerId === viceCaptainId,
    priceTenths: priced.get(playerId)!.priceTenths,
  }));

  try {
    await saveSquad(session.accessToken, season, {
      name,
      activeFromGameweek: gameweek,
      picks,
      transfersMade: diff.count,
      transferCost: cost,
      chip,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', errors: [], message: `Could not save: ${message}` };
  }

  revalidatePath('/fantasy');
  await trackServerEvent('squad_saved', session.userId, { gameweek, transfers: diff.count, transferCost: cost, chip });
  // A chip is the most consequential thing a save can do and the hardest to
  // undo, so it is named back explicitly rather than left to be inferred from
  // a button that now has a tick on it.
  const notes = [
    chip === null ? null : `${CHIP_LABELS[chip]} played.`,
    cost > 0 ? `${diff.count} transfers cost ${cost} points.` : null,
  ].filter((n): n is string => n !== null);

  return {
    status: 'saved',
    errors: [],
    message: [`Saved — this side plays from gameweek ${gameweek}.`, ...notes].join(' '),
  };
}

/**
 * `selectionErrors` reports the club limit by id, because the rules module is
 * given no names. This is the one place that has the roster, so this is where
 * the id becomes something a manager recognises.
 */
function namedClubs(errors: readonly string[], pool: readonly { teamId: number | null; teamName: string | null }[]): string[] {
  const nameById = new Map<number, string>();
  for (const p of pool) {
    if (p.teamId !== null && p.teamName !== null) nameById.set(p.teamId, p.teamName);
  }
  return errors.map((error) =>
    error.replace(/club (\d+)/, (whole, id: string) => nameById.get(Number(id)) ?? whole),
  );
}
