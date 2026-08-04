import { IN_PLAY_STATUSES } from '@/lib/providers/types';
import type { FixtureWithTeams } from '@/lib/site/rows';

export type SpineRowKind = 'upcoming' | 'played' | 'live' | 'postponed';

/**
 * Statuses that will never produce a real score. Mirrors
 * `lib/site/scoreDisplay.ts`'s `DEAD_STATUSES` (kept as a separate copy
 * here, not imported, since that module's set is a private implementation
 * detail rather than a shared export — same three statuses, same meaning).
 */
const DEAD_STATUSES = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED']);

type SpineFixture = Pick<FixtureWithTeams, 'status' | 'home_goals' | 'away_goals'>;

/**
 * Which of the matchday spine's four row states a fixture renders as. Pure
 * and fixture-shape-only (no `now` needed) so it is trivially unit-testable
 * — see tests/site/spine.test.ts.
 *
 * Order matters: IN_PLAY/PAUSED wins first (a fixture is never "played"
 * while still live, even though it already has a running score), then the
 * postponed/cancelled/suspended family (these never carry a trustworthy
 * score even if one happens to be set), then a genuine score pair — never
 * inferred from status alone — and upcoming otherwise.
 */
export function spineRowKind(fixture: SpineFixture): SpineRowKind {
  if (IN_PLAY_STATUSES.includes(fixture.status)) return 'live';
  if (DEAD_STATUSES.has(fixture.status)) return 'postponed';
  const hasScore = fixture.home_goals !== null && fixture.away_goals !== null;
  if (hasScore) return 'played';
  return 'upcoming';
}

/**
 * The spine row's centre cell: an em dash before a ball has been kicked (or
 * for a fixture that will never resume), the score once `spineRowKind` says
 * one exists. Kept separate from `spineRowKind` — and taking the kind as a
 * parameter rather than recomputing it — so a row only ever displays a
 * score for the exact kinds `spineRowKind` calls "played"/"live", with no
 * chance of the two functions drifting apart.
 */
export function spineCenterText(fixture: Pick<FixtureWithTeams, 'home_goals' | 'away_goals'>, kind: SpineRowKind): string {
  if (kind === 'played' || kind === 'live') {
    return `${fixture.home_goals}–${fixture.away_goals}`;
  }
  return '—';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DayRailParts {
  day: number;
  month: string;
  weekday: string;
}

/** The day rail's day number / month / weekday, parsed from a `YYYY-MM-DD` group key (UTC, matching every other date-grouping in this app). */
export function dayRailParts(dateIso: string): DayRailParts {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return {
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()] ?? '',
    weekday: WEEKDAYS[d.getUTCDay()] ?? '',
  };
}
