import { describe, it, expect } from 'vitest';
import { planGameweekIngest, DEFAULT_GAMEWEEK_LIMIT, type GameweekState } from '@/lib/ingest/gameweekSchedule';
import type { FplEvent } from '@/lib/providers/fpl';

const NOW = new Date('2026-10-01T12:00:00Z');
const PAST = '2026-09-01T17:30:00Z';
const FUTURE = '2026-11-01T17:30:00Z';

function event(id: number, over: Partial<FplEvent> = {}): FplEvent {
  return {
    id,
    name: `Gameweek ${id}`,
    deadlineTime: PAST,
    finished: false,
    dataChecked: false,
    isCurrent: false,
    isNext: false,
    ...over,
  };
}

function settled(...ids: number[]): GameweekState[] {
  return ids.map((gameweek) => ({ gameweek, isFinal: true }));
}

describe('planGameweekIngest — what gets fetched', () => {
  it('fetches nothing before the season starts', () => {
    const events = [event(1, { deadlineTime: FUTURE, isNext: true }), event(2, { deadlineTime: FUTURE })];
    const plan = planGameweekIngest(events, [], { now: NOW });
    expect(plan.fetch).toEqual([]);
    expect(plan.reason).toMatch(/no gameweek has started/);
  });

  it('fetches the gameweek in progress', () => {
    const events = [event(1, { finished: true, dataChecked: true }), event(2, { isCurrent: true })];
    expect(planGameweekIngest(events, settled(1), { now: NOW }).fetch).toEqual([2]);
  });

  it('keeps re-fetching a finished gameweek until FPL marks it checked', () => {
    // Bonus points and corrections land after the final whistle. `finished`
    // is not `data_checked`, and treating it as such freezes a half-scored
    // week.
    const events = [event(1, { finished: true, dataChecked: false })];
    expect(planGameweekIngest(events, [{ gameweek: 1, isFinal: false }], { now: NOW }).fetch).toEqual([1]);
  });

  it('stops fetching once the gameweek is settled both upstream and here', () => {
    const events = [event(1, { finished: true, dataChecked: true })];
    const plan = planGameweekIngest(events, settled(1), { now: NOW });
    expect(plan.fetch).toEqual([]);
    expect(plan.reason).toMatch(/settled/);
  });

  it('fetches a settled gameweek we never stored — the gap a failed run leaves', () => {
    const events = [1, 2, 3].map((id) => event(id, { finished: true, dataChecked: true }));
    expect(planGameweekIngest(events, settled(1, 3), { now: NOW }).fetch).toEqual([2]);
  });

  it('re-fetches a gameweek stored final that FPL no longer calls checked', () => {
    // We recorded a provisional week as settled. Believing our own flag over
    // the provider's would leave it wrong forever.
    const events = [event(1, { finished: true, dataChecked: false })];
    expect(planGameweekIngest(events, settled(1), { now: NOW }).fetch).toEqual([1]);
  });

  it('treats stored-but-not-final the same as never stored', () => {
    const events = [event(1, { finished: true, dataChecked: true })];
    expect(planGameweekIngest(events, [{ gameweek: 1, isFinal: false }], { now: NOW }).fetch).toEqual([1]);
  });
});

describe('planGameweekIngest — when a gameweek counts as started', () => {
  it('counts a gameweek past its deadline', () => {
    expect(planGameweekIngest([event(1, { deadlineTime: PAST })], [], { now: NOW }).fetch).toEqual([1]);
  });

  it('does not count one whose deadline has not passed', () => {
    expect(planGameweekIngest([event(1, { deadlineTime: FUTURE })], [], { now: NOW }).fetch).toEqual([]);
  });

  it('trusts FPL’s own flags over a missing or unreadable deadline', () => {
    const noDeadline = event(1, { deadlineTime: null });
    expect(planGameweekIngest([noDeadline], [], { now: NOW }).fetch).toEqual([]);
    expect(planGameweekIngest([{ ...noDeadline, isCurrent: true }], [], { now: NOW }).fetch).toEqual([1]);

    const unreadable = event(2, { deadlineTime: 'next Saturday' });
    expect(planGameweekIngest([unreadable], [], { now: NOW }).fetch).toEqual([]);
    expect(planGameweekIngest([{ ...unreadable, finished: true }], [], { now: NOW }).fetch).toEqual([2]);
  });

  it('never counts the next gameweek as started, whatever its deadline says', () => {
    // A stale deadline on `is_next` would otherwise fetch a week nobody has
    // played, and store a full page of zeroes as if they were results.
    const stale = event(9, { deadlineTime: PAST, isNext: true });
    expect(planGameweekIngest([stale], [], { now: NOW }).fetch).toEqual([]);
  });
});

describe('planGameweekIngest — the per-run limit', () => {
  const coldStart = Array.from({ length: 12 }, (_, i) => event(i + 1, { finished: true, dataChecked: true }));

  it('caps a cold start and defers the rest in order', () => {
    const plan = planGameweekIngest(coldStart, [], { now: NOW });
    expect(plan.fetch).toHaveLength(DEFAULT_GAMEWEEK_LIMIT);
    expect(plan.fetch).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.deferred).toEqual([7, 8, 9, 10, 11, 12]);
    expect(plan.reason).toMatch(/limit 6/);
  });

  it('catches up from oldest to newest across runs', () => {
    const first = planGameweekIngest(coldStart, [], { now: NOW });
    const second = planGameweekIngest(coldStart, settled(...first.fetch), { now: NOW });
    expect(second.fetch).toEqual([7, 8, 9, 10, 11, 12]);
    expect(second.deferred).toEqual([]);
  });

  it('honours an explicit limit', () => {
    expect(planGameweekIngest(coldStart, [], { now: NOW, limit: 2 }).fetch).toEqual([1, 2]);
  });

  it('says nothing about a limit when nothing was deferred', () => {
    const plan = planGameweekIngest([event(1, { isCurrent: true })], [], { now: NOW });
    expect(plan.reason).not.toMatch(/limit/);
    expect(plan.deferred).toEqual([]);
  });
});
