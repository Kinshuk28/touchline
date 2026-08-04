import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  planFplIdentityAssignment,
  applyFplIdentityPlans,
  type FplIdentityPlan,
  type OrphanRef,
} from '@/lib/ingest/fplIdentityMerge';

vi.mock('@/lib/db/repositories/players', () => ({
  setPlayerFplIdentity: vi.fn(async () => {}),
  deletePlayersByIds: vi.fn(async () => {}),
}));
vi.mock('@/lib/db/repositories/playerStats', () => ({
  repointPlayerSeasonStats: vi.fn(async () => {}),
}));

import { setPlayerFplIdentity, deletePlayersByIds } from '@/lib/db/repositories/players';
import { repointPlayerSeasonStats } from '@/lib/db/repositories/playerStats';

describe('planFplIdentityAssignment', () => {
  it('assigns when nothing currently holds the fpl_id', () => {
    const plan = planFplIdentityAssignment({ targetPlayerId: 10, fplId: 500, photoUrl: 'p.png' }, undefined);
    expect(plan).toEqual({ action: 'assign', targetPlayerId: 10, fplId: 500, photoUrl: 'p.png' });
  });

  it('no-ops when the fpl_id is already on the same row', () => {
    const plan = planFplIdentityAssignment(
      { targetPlayerId: 10, fplId: 500, photoUrl: 'p.png' },
      { id: 10, orphan: undefined },
    );
    expect(plan).toEqual({ action: 'noop', targetPlayerId: 10, fplId: 500 });
  });

  it('merges when the fpl_id is on a different orphan row (fd_id null)', () => {
    const orphan: OrphanRef = { id: 99, fpl_id: 500, photo_url: 'old.png' };
    const plan = planFplIdentityAssignment(
      { targetPlayerId: 10, fplId: 500, photoUrl: 'new.png' },
      { id: 99, orphan },
    );
    expect(plan).toEqual({ action: 'merge', targetPlayerId: 10, fplId: 500, photoUrl: 'new.png', orphan });
  });

  it('skips when the fpl_id is on a different row that is itself already fully merged (has its own fd_id)', () => {
    const plan = planFplIdentityAssignment(
      { targetPlayerId: 10, fplId: 500, photoUrl: 'p.png' },
      { id: 42, orphan: undefined },
    );
    expect(plan).toMatchObject({ action: 'skip', targetPlayerId: 10, fplId: 500 });
    expect((plan as { reason: string }).reason).toMatch(/already belongs to a different/);
  });
});

describe('applyFplIdentityPlans', () => {
  beforeEach(() => {
    vi.mocked(setPlayerFplIdentity).mockClear();
    vi.mocked(deletePlayersByIds).mockClear();
    vi.mocked(repointPlayerSeasonStats).mockClear();
  });

  it('deletes merged orphans before assigning fpl_id, across the whole batch', async () => {
    const calls: string[] = [];
    vi.mocked(repointPlayerSeasonStats).mockImplementation(async () => {
      calls.push('repoint');
    });
    vi.mocked(deletePlayersByIds).mockImplementation(async () => {
      calls.push('delete');
    });
    vi.mocked(setPlayerFplIdentity).mockImplementation(async () => {
      calls.push('assign');
    });

    const orphan: OrphanRef = { id: 99, fpl_id: 500, photo_url: null };
    const plans: FplIdentityPlan[] = [
      { action: 'merge', targetPlayerId: 10, fplId: 500, photoUrl: 'new.png', orphan },
    ];
    const result = await applyFplIdentityPlans(plans, () => {});

    expect(calls).toEqual(['repoint', 'delete', 'assign']);
    expect(result).toEqual({ assigned: 0, merged: 1, skipped: 0, noop: 0 });
    expect(deletePlayersByIds).toHaveBeenCalledWith([99]);
    expect(setPlayerFplIdentity).toHaveBeenCalledWith([{ id: 10, fpl_id: 500, photo_url: 'new.png' }]);
  });

  it('a merge whose repoint throws is skipped and logged, and does not stop the rest of the batch', async () => {
    vi.mocked(repointPlayerSeasonStats).mockRejectedValueOnce(new Error('boom'));

    const badOrphan: OrphanRef = { id: 1, fpl_id: 100, photo_url: null };
    const goodOrphan: OrphanRef = { id: 2, fpl_id: 200, photo_url: null };
    const plans: FplIdentityPlan[] = [
      { action: 'merge', targetPlayerId: 11, fplId: 100, photoUrl: null, orphan: badOrphan },
      { action: 'merge', targetPlayerId: 12, fplId: 200, photoUrl: null, orphan: goodOrphan },
    ];
    const logged: string[] = [];
    const result = await applyFplIdentityPlans(plans, (m) => logged.push(m));

    expect(result).toEqual({ assigned: 0, merged: 1, skipped: 1, noop: 0 });
    expect(logged.some((m) => m.includes('boom'))).toBe(true);
    // Only the surviving merge's orphan is deleted / assigned.
    expect(deletePlayersByIds).toHaveBeenCalledWith([2]);
    expect(setPlayerFplIdentity).toHaveBeenCalledWith([{ id: 12, fpl_id: 200, photo_url: null }]);
  });

  it('logs and counts a skip plan without touching the database', async () => {
    const plans: FplIdentityPlan[] = [
      { action: 'skip', targetPlayerId: 10, fplId: 500, reason: 'already belongs to a different, already-merged player (id 42)' },
    ];
    const logged: string[] = [];
    const result = await applyFplIdentityPlans(plans, (m) => logged.push(m));

    expect(result).toEqual({ assigned: 0, merged: 0, skipped: 1, noop: 0 });
    expect(logged).toHaveLength(1);
    expect(deletePlayersByIds).not.toHaveBeenCalled();
    expect(setPlayerFplIdentity).not.toHaveBeenCalled();
  });

  it('counts a noop plan without writing anything', async () => {
    const plans: FplIdentityPlan[] = [{ action: 'noop', targetPlayerId: 10, fplId: 500 }];
    const result = await applyFplIdentityPlans(plans, () => {});

    expect(result).toEqual({ assigned: 0, merged: 0, skipped: 0, noop: 1 });
    expect(deletePlayersByIds).not.toHaveBeenCalled();
    expect(setPlayerFplIdentity).not.toHaveBeenCalled();
  });

  it('batches a mix of assign and merge plans into a single delete call and a single assign call', async () => {
    const orphan: OrphanRef = { id: 99, fpl_id: 500, photo_url: null };
    const plans: FplIdentityPlan[] = [
      { action: 'assign', targetPlayerId: 1, fplId: 100, photoUrl: 'a.png' },
      { action: 'merge', targetPlayerId: 2, fplId: 500, photoUrl: 'b.png', orphan },
    ];
    const result = await applyFplIdentityPlans(plans, () => {});

    expect(result).toEqual({ assigned: 1, merged: 1, skipped: 0, noop: 0 });
    expect(deletePlayersByIds).toHaveBeenCalledTimes(1);
    expect(setPlayerFplIdentity).toHaveBeenCalledTimes(1);
    expect(setPlayerFplIdentity).toHaveBeenCalledWith([
      { id: 1, fpl_id: 100, photo_url: 'a.png' },
      { id: 2, fpl_id: 500, photo_url: 'b.png' },
    ]);
  });
});
