'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getPlayerPool, getFantasyCalendar, getFantasySeason } from '@/lib/site/queries/fantasy';
import { openGameweek } from '@/lib/fantasy/gameweekWindow';
import { saveSquad } from '@/lib/fantasy/squadStore';
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
});

export interface SaveState {
  status: 'idle' | 'saved' | 'error';
  /** Everything wrong at once, so a manager fixes one squad rather than discovering five refusals. */
  errors: string[];
  message: string;
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
  const { name, starters, bench, captainId, viceCaptainId } = parsed.data;

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

  const selected = ids.map((id) => byId.get(id)!);
  const startingPlayers = starters.map((id) => byId.get(id)!);
  const benchPlayers = bench.map((id) => byId.get(id)!);

  const errors = [
    ...selectionErrors(selected),
    ...lineupErrors(startingPlayers, { captainId, viceCaptainId }),
  ];
  if (errors.length > 0) {
    return { status: 'error', errors: namedClubs(errors, pool), message: 'That squad is not legal yet.' };
  }

  // Which gameweek this takes effect from. Once a deadline passes the picks
  // for that week are settled, so a save becomes the *next* week's side —
  // see lib/fantasy/gameweekWindow.ts for why that rule is the whole game.
  const calendar = await getFantasyCalendar(season);
  const gameweek = openGameweek(calendar);
  if (gameweek === null) {
    return { status: 'error', errors: [], message: 'The season is over — there is no gameweek left to pick for.' };
  }

  const slots = assignSlots(startingPlayers, benchPlayers);
  const picks = slots.map(({ playerId, slot }) => ({
    playerId,
    slot,
    isCaptain: playerId === captainId,
    isViceCaptain: playerId === viceCaptainId,
  }));

  try {
    await saveSquad(session.accessToken, session.userId, season, { name, activeFromGameweek: gameweek, picks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', errors: [], message: `Could not save: ${message}` };
  }

  revalidatePath('/fantasy');
  return { status: 'saved', errors: [], message: `Saved — this side plays from gameweek ${gameweek}.` };
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
