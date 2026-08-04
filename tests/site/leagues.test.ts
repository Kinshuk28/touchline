import { describe, it, expect } from 'vitest';
import { earliestKickoffPerLeague, type KickoffCandidate } from '@/lib/site/queries/leagues';
import type { LeagueRow } from '@/lib/site/rows';

function league(id: number, fd_code: string): LeagueRow {
  return { id, fd_code, slug: fd_code.toLowerCase(), name: `${fd_code} League`, country: 'X', emblem_url: null, current_season: 2026 };
}

function candidate(overrides: Partial<KickoffCandidate> & { league_id: number; kickoff_utc: string }): KickoffCandidate {
  return { status: 'SCHEDULED', ...overrides };
}

const PL = league(1, 'PL');
const PD = league(2, 'PD');

describe('earliestKickoffPerLeague', () => {
  it('picks the earliest fixture per league', () => {
    const result = earliestKickoffPerLeague([PL], [
      candidate({ league_id: 1, kickoff_utc: '2026-08-20T00:00:00Z' }),
      candidate({ league_id: 1, kickoff_utc: '2026-08-16T00:00:00Z' }),
      candidate({ league_id: 1, kickoff_utc: '2026-08-18T00:00:00Z' }),
    ]);
    expect(result).toEqual([{ league: PL, kickoffUtc: '2026-08-16T00:00:00Z' }]);
  });

  it("ignores other leagues' fixtures", () => {
    const result = earliestKickoffPerLeague([PL, PD], [
      candidate({ league_id: 1, kickoff_utc: '2026-08-20T00:00:00Z' }),
      candidate({ league_id: 2, kickoff_utc: '2026-08-15T00:00:00Z' }),
    ]);
    expect(result).toEqual([
      { league: PL, kickoffUtc: '2026-08-20T00:00:00Z' },
      { league: PD, kickoffUtc: '2026-08-15T00:00:00Z' },
    ]);
  });

  it('returns null for a league with no qualifying fixtures — never invents a date', () => {
    const result = earliestKickoffPerLeague([PL, PD], [
      candidate({ league_id: 1, kickoff_utc: '2026-08-20T00:00:00Z' }),
    ]);
    expect(result).toEqual([
      { league: PL, kickoffUtc: '2026-08-20T00:00:00Z' },
      { league: PD, kickoffUtc: null },
    ]);
  });

  // Finding 1 regression test: a POSTPONED (or CANCELLED) fixture keeps its
  // original kickoff_utc, which can sort earlier than the real next match.
  // Unlike getUpcoming (which explicitly scopes to SCHEDULED/TIMED), the
  // pre-fix reduction took the minimum kickoff_utc across every status, so
  // the countdown could point at a match that will never be played. This
  // test must fail against the pre-fix implementation — see
  // .superpowers/sdd/task-8-report.md for the captured RED output.
  it('excludes POSTPONED/CANCELLED fixtures even when their kickoff is earlier than a valid one', () => {
    const result = earliestKickoffPerLeague([PL], [
      candidate({ league_id: 1, kickoff_utc: '2026-08-10T00:00:00Z', status: 'POSTPONED' }),
      candidate({ league_id: 1, kickoff_utc: '2026-08-12T00:00:00Z', status: 'CANCELLED' }),
      candidate({ league_id: 1, kickoff_utc: '2026-08-16T00:00:00Z', status: 'SCHEDULED' }),
    ]);
    expect(result).toEqual([{ league: PL, kickoffUtc: '2026-08-16T00:00:00Z' }]);
  });
});
