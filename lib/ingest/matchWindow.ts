import { IN_PLAY_STATUSES, type FixtureStatus } from '@/lib/providers/types';

export interface WindowFixture {
  status: FixtureStatus;
  kickoffUtc: string;
}

// POSTPONED and CANCELLED are truly dead — fixtures will not resume.
// SUSPENDED is not dead: a match halted mid-play by floodlight failure, weather, or crowd trouble
// can resume as IN_PLAY on the very next poll. Treating it as dead would close the ingestion
// window while a real, resumable match is live, silently stopping live scores for all leagues.
// Keeping SUSPENDED "relevant" means its kickoff time contributes to the window bounds like SCHEDULED,
// ensuring the window stays open through the suspension and any resumption.
const DEAD_STATUSES: FixtureStatus[] = ['POSTPONED', 'CANCELLED'];

export function isMatchWindowOpen(
  fixtures: WindowFixture[],
  now: Date,
  leadMinutes = 15,
  trailMinutes = 150,
): boolean {
  const relevant = fixtures.filter((f) => !DEAD_STATUSES.includes(f.status));
  if (relevant.length === 0) return false;

  if (relevant.some((f) => IN_PLAY_STATUSES.includes(f.status))) return true;

  // Filter out fixtures with unparseable kickoff times; one NaN would poison
  // Math.min/max and break the guard for all other fixtures. The DB column
  // is `timestamptz not null`, so this shouldn't happen, but the function is
  // exported and pure — defensive filtering is appropriate here.
  const parseable = relevant.filter((f) => {
    const t = new Date(f.kickoffUtc).getTime();
    return !Number.isNaN(t);
  });
  if (parseable.length === 0) return false;

  const times = parseable.map((f) => new Date(f.kickoffUtc).getTime());
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const t = now.getTime();

  return t >= earliest - leadMinutes * 60_000 && t <= latest + trailMinutes * 60_000;
}
