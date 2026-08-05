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

export interface SpineStateLabel {
  text: string;
  live: boolean;
}

/**
 * The status label shown on a spine/competition-group row — Direction
 * Two's football vernacular (spec: "'FT', 'HT', 'Postp.' as status
 * labels"). Keyed off the fixture's raw `status` rather than
 * `spineRowKind`'s coarser four-way split: `kind` alone can't tell HT from
 * IN_PLAY (both are `'live'`) or Postponed from Cancelled (both
 * `'postponed'`), and this needs to. `null` for SCHEDULED/TIMED — an
 * upcoming fixture has nothing to report here, matching the "reclaimed,
 * not reserved" state column both `MatchdaySpine` and `/scores`'
 * `CompetitionGroup` already apply: this column only takes up row space
 * when there's something to put in it.
 *
 * `live: false` for PAUSED (half-time) — same reasoning as
 * `scoreDisplay.ts#stateLabel`: nothing is happening on the pitch right
 * now, so the pulsing-dot "Live" treatment would be misleading.
 */
export function spineStateLabel(fixture: Pick<FixtureWithTeams, 'status'>): SpineStateLabel | null {
  switch (fixture.status) {
    case 'IN_PLAY':
      return { text: 'Live', live: true };
    case 'PAUSED':
      return { text: 'HT', live: false };
    case 'FINISHED':
    case 'AWARDED':
      return { text: 'FT', live: false };
    case 'POSTPONED':
      return { text: 'Postp.', live: false };
    case 'CANCELLED':
    case 'SUSPENDED':
      return { text: 'Off', live: false };
    default:
      return null;
  }
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

/**
 * Groups fixtures into the `{ date, fixtures }[]` shape `<MatchdaySpine>`
 * expects (structurally identical to its own `SpineDay`, so callers can pass
 * this straight through with no import cycle between this module and the
 * component). Assumes `fixtures` is already ordered ascending by
 * `kickoff_utc` — true of every query that feeds this (`getUpcoming`,
 * `getFixturesInRange`) — and preserves that order both across day groups
 * (via `Map`'s insertion-order iteration) and within each group. Used by the
 * landing page's spine section and by `/calendar`.
 */
export function groupFixturesByDay(
  fixtures: FixtureWithTeams[],
): Array<{ date: string; fixtures: FixtureWithTeams[] }> {
  const byDay = new Map<string, FixtureWithTeams[]>();
  for (const f of fixtures) {
    const day = f.kickoff_utc.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), f]);
  }
  return [...byDay.entries()].map(([date, dayFixtures]) => ({ date, fixtures: dayFixtures }));
}
