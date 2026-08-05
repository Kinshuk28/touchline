import { formatKickoffTime } from '@/lib/site/format';
import { IN_PLAY_STATUSES } from '@/lib/providers/types';
import type { FixtureWithTeams } from '@/lib/site/rows';

// A terminal, recently-finished result — shown as "FT", never re-checked
// against the recency window here (getLiveAndRecent already only returns
// fixtures worth displaying, recent or otherwise).
const RECENT_FINISHED_STATUSES = new Set(['FINISHED', 'AWARDED']);

// Never shown as live and never carries a score worth trusting as final.
const DEAD_STATUSES = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED']);

// A fixture whose kickoff has passed but whose status hasn't flipped to
// IN_PLAY yet — the normal state for up to a few minutes given the ingest
// cadence (Important 7). Same status set `getLiveAndRecent`'s grace-window
// branch uses to keep the fixture visible at all; this is what decides how
// it reads once it is.
const KICKOFF_PENDING_STATUSES = new Set(['SCHEDULED', 'TIMED']);

/**
 * The text shown in a score row's centre cell: the score once one exists
 * (including a genuine 0–0), a dash for a fixture that will never resume,
 * "Kicked off" for a fixture whose kickoff has passed but has no score yet
 * (never inventing a score it doesn't have), otherwise the kickoff time. A
 * `null` score is never rendered as a score — only an actual pair of
 * numbers counts as "has a score."
 */
export function scoreCellText(fixture: FixtureWithTeams, now: Date): string {
  const hasScore = fixture.home_goals !== null && fixture.away_goals !== null;
  if (hasScore) return `${fixture.home_goals}–${fixture.away_goals}`;
  if (DEAD_STATUSES.has(fixture.status)) return '—';
  if (
    KICKOFF_PENDING_STATUSES.has(fixture.status) &&
    new Date(fixture.kickoff_utc).getTime() <= now.getTime()
  ) {
    return 'Kicked off';
  }
  return formatKickoffTime(fixture.kickoff_utc, now);
}

/**
 * The right-hand state label — "Live", "HT", "FT", "Postp.", "Off" — `null`
 * when a fixture is simply upcoming and has no state worth calling out.
 * Direction Two's football-vernacular labels (spec: "'FT', 'HT', 'Postp.'
 * as status labels"): PAUSED is half-time, a real, distinct state the data
 * already carries (`FixtureStatus` has separate `IN_PLAY`/`PAUSED` values),
 * so it gets its own label rather than folding into "Live" as before —
 * `live: false` for it, deliberately: nothing is happening on the pitch
 * right now, so the pulsing-dot "Live" treatment (`ScoreRow`) would be
 * misleading.
 */
export function stateLabel(fixture: FixtureWithTeams): { text: string; live: boolean } | null {
  if (fixture.status === 'PAUSED') {
    return { text: 'HT', live: false };
  }
  if (IN_PLAY_STATUSES.includes(fixture.status)) {
    return { text: 'Live', live: true };
  }
  if (DEAD_STATUSES.has(fixture.status)) {
    return { text: fixture.status === 'POSTPONED' ? 'Postp.' : 'Off', live: false };
  }
  if (RECENT_FINISHED_STATUSES.has(fixture.status)) {
    return { text: 'FT', live: false };
  }
  return null;
}
