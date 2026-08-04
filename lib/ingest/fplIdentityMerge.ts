import { deletePlayersByIds, setPlayerFplIdentity } from '@/lib/db/repositories/players';
import { repointPlayerSeasonStats } from '@/lib/db/repositories/playerStats';

/**
 * Shared merge logic for landing an FPL identity (`fpl_id` + `photo_url`) on
 * a football-data player row, used by both the recurring ingestion job
 * (`scripts/ingest/players.ts`) and the one-shot repair
 * (`scripts/repair/mergeFplPlayers.ts`). It used to live twice, once per
 * script, slightly differently -- which is exactly how the recurring job
 * ended up *not* doing what the repair does: `players.fpl_id` is uniquely
 * constrained, and neither script's original write path accounted for that
 * `fpl_id` already sitting on an orphan row (an FPL-only row, `fd_id` null,
 * left behind by the pre-fix job or a still-unresolved miss) other than the
 * one about to receive it. A plain `UPDATE ... SET fpl_id = X WHERE id = Y`
 * against a row that isn't the one already holding `X` throws a unique
 * violation and takes the whole run down with it.
 *
 * `planFplIdentityAssignment` is the pure decision: given who (if anyone)
 * currently holds the fpl_id, decide whether landing it on `targetPlayerId`
 * is a no-op, a plain assign, a merge (repoint the orphan's stats onto the
 * target, delete the orphan, then assign), or unsafe to do at all. It takes
 * no database dependency so the decision matrix is unit-testable without one.
 * `applyFplIdentityPlans` is the (small) amount of I/O orchestration needed
 * to actually execute a batch of those decisions safely.
 */

export interface OrphanRef {
  /** Internal `players.id` of the orphan row (`fd_id` null, `fpl_id` set). */
  id: number;
  fpl_id: number;
  photo_url: string | null;
}

export interface FplIdentityAssignment {
  /** The football-data row the tiered matcher chose as the destination. */
  targetPlayerId: number;
  fplId: number;
  photoUrl: string | null;
}

/**
 * Whatever currently holds `fplId`, if anything -- `undefined` if no row
 * does. When something does, `orphan` carries its orphan shape (`fd_id`
 * null) iff that row *is* an orphan; a row that already holds the fpl_id
 * *and* has an `fd_id` of its own is a fully-merged, different player, and
 * `orphan` is `undefined` for it.
 */
export interface FplIdentityOwner {
  id: number;
  orphan: OrphanRef | undefined;
}

export type FplIdentityPlan =
  | { action: 'noop'; targetPlayerId: number; fplId: number }
  | { action: 'assign'; targetPlayerId: number; fplId: number; photoUrl: string | null }
  | { action: 'merge'; targetPlayerId: number; fplId: number; photoUrl: string | null; orphan: OrphanRef }
  | { action: 'skip'; targetPlayerId: number; fplId: number; reason: string };

export function planFplIdentityAssignment(
  assignment: FplIdentityAssignment,
  currentOwner: FplIdentityOwner | undefined,
): FplIdentityPlan {
  const { targetPlayerId, fplId, photoUrl } = assignment;

  if (currentOwner === undefined) {
    return { action: 'assign', targetPlayerId, fplId, photoUrl };
  }
  if (currentOwner.id === targetPlayerId) {
    return { action: 'noop', targetPlayerId, fplId };
  }
  if (currentOwner.orphan !== undefined) {
    return { action: 'merge', targetPlayerId, fplId, photoUrl, orphan: currentOwner.orphan };
  }
  // currentOwner has its own fd_id: it's a distinct, already-resolved
  // player, not a leftover orphan. Landing this fpl_id on `targetPlayerId`
  // would steal it from a real, different person -- never guess, skip and
  // let the caller log it instead.
  return {
    action: 'skip',
    targetPlayerId,
    fplId,
    reason: `fpl_id ${fplId} already belongs to a different, already-merged player (id ${currentOwner.id})`,
  };
}

export interface ApplyPlansResult {
  assigned: number;
  merged: number;
  skipped: number;
  noop: number;
}

/**
 * Executes a batch of plans. Ordering matters, same as the original one-shot
 * repair:
 *   1. Every merge's `player_season_stats` rows must be repointed onto the
 *      target before its orphan is deleted -- `player_id` is a foreign key
 *      `on delete cascade`, so deleting first would cascade-delete real
 *      stats instead of letting them move.
 *   2. Every orphan being merged away must be deleted *before* any `fpl_id`
 *      is written -- `players.fpl_id` is unique, and the target and its
 *      about-to-be-merged orphan would otherwise briefly both hold it.
 *
 * A merge whose repoint fails (or a plan the caller marked unsafe) is
 * skipped and logged rather than thrown -- one bad record must never fail
 * the whole run.
 */
export async function applyFplIdentityPlans(
  plans: readonly FplIdentityPlan[],
  log: (message: string) => void = console.warn,
): Promise<ApplyPlansResult> {
  const result: ApplyPlansResult = { assigned: 0, merged: 0, skipped: 0, noop: 0 };
  const toDelete: number[] = [];
  const toAssign: { id: number; fpl_id: number; photo_url: string | null }[] = [];

  for (const plan of plans) {
    switch (plan.action) {
      case 'noop':
        result.noop++;
        break;
      case 'skip':
        log(`players: skipping fpl_id ${plan.fplId} -> player ${plan.targetPlayerId}: ${plan.reason}`);
        result.skipped++;
        break;
      case 'assign':
        toAssign.push({ id: plan.targetPlayerId, fpl_id: plan.fplId, photo_url: plan.photoUrl });
        result.assigned++;
        break;
      case 'merge':
        try {
          await repointPlayerSeasonStats(plan.orphan.id, plan.targetPlayerId);
          toDelete.push(plan.orphan.id);
          toAssign.push({ id: plan.targetPlayerId, fpl_id: plan.fplId, photo_url: plan.photoUrl });
          result.merged++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(
            `players: failed to merge orphan ${plan.orphan.id} onto player ${plan.targetPlayerId}, skipping: ${message}`,
          );
          result.skipped++;
        }
        break;
    }
  }

  // Deletes before assigns, across the whole batch -- see the doc comment.
  if (toDelete.length > 0) await deletePlayersByIds(toDelete);
  if (toAssign.length > 0) await setPlayerFplIdentity(toAssign);

  return result;
}
