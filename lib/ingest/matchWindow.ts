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

// Fixtures are upserted only if their status is in-play/paused (always relevant)
// or if they finished recently enough (within 150 minutes of kickoff) to plausibly
// belong to the current polling window. Finished fixtures older than 150 minutes
// must not be re-upserted on every poll, which would cause a steadily growing
// volume of pointless database writes as the season progresses.
export const LIVE_RELEVANCE_TRAIL_MINUTES = 150;

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

/**
 * Determines whether a fixture should be upserted during the live polling window.
 *
 * IN_PLAY and PAUSED fixtures are always relevant — match state changes on every poll.
 * SUSPENDED and AWARDED are also always relevant: these are exactly the transitions the
 * live job needs to be the fast writer for. Before this fix, `isLiveRelevant` returned
 * `false` for SUSPENDED even though `isMatchWindowOpen` deliberately keeps the polling
 * window open through a suspension (see that function's doc comment) — the two fixes
 * disagreed, so the live job kept polling (burning requests) but never actually wrote
 * the SUSPENDED status, leaving the site showing a suspended match as still IN_PLAY
 * until core.ts's next hourly sweep corrected it. AWARDED (a match awarded to a team,
 * e.g. after a forfeit) has the identical shape: a live-window transition that must be
 * written immediately, not left for the hourly job.
 *
 * FINISHED fixtures are relevant only if they finished recently (within LIVE_RELEVANCE_TRAIL_MINUTES
 * of kickoff), to avoid re-upserts of hundreds of completed matches every five minutes
 * once the season progresses. A fixture that finished three weeks ago must not appear
 * in the live job's writes — that would cause a steadily growing database write volume
 * as the season accumulates finished matches. SUSPENDED/AWARDED are not given the same
 * trail-window treatment: both are rare, and both only ever arise on a fixture already
 * inside the live-polling window (a match must have started to be suspended, or to be
 * awarded following an abandonment), so there is no equivalent long-tail growth risk.
 *
 * SCHEDULED/TIMED/POSTPONED/CANCELLED fixtures are never written by the live job.
 */
export function isLiveRelevant(fixture: { status: FixtureStatus; kickoffUtc: string }, now: Date): boolean {
  // In-play, paused, suspended, or awarded: always relevant, regardless of kickoff time.
  if (IN_PLAY_STATUSES.includes(fixture.status) || fixture.status === 'SUSPENDED' || fixture.status === 'AWARDED') {
    return true;
  }

  // Finished: relevant only if recent.
  if (fixture.status === 'FINISHED') {
    const kickoffTime = new Date(fixture.kickoffUtc).getTime();
    if (Number.isNaN(kickoffTime)) {
      return false;
    }
    const nowTime = now.getTime();
    const elapsedMs = nowTime - kickoffTime;
    const trailMs = LIVE_RELEVANCE_TRAIL_MINUTES * 60_000;
    return elapsedMs <= trailMs;
  }

  // Everything else: not relevant (SCHEDULED, TIMED, POSTPONED, CANCELLED).
  return false;
}
