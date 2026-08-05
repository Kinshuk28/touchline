import { dayRailParts } from '@/lib/site/spine';

/**
 * Honest headings for the landing dashboard's fixture panel.
 *
 * The spec's sketch labels that panel "THIS WEEKEND", and during the season
 * that is what it holds. But this build ships in preseason — the first
 * fixture of 2026-27 is 2026-08-16, eleven days out — and a panel headed
 * "This weekend" over fixtures that are not this weekend is exactly the
 * kind of invented framing the rest of this app refuses. So the heading is
 * derived from the fixtures actually being shown, and a mono date range
 * always sits beside it, whichever heading wins.
 */

const WEEKEND_DAYS = new Set([5, 6, 0]); // Fri, Sat, Sun (UTC getUTCDay)

/** Whole days between two `YYYY-MM-DD` dates, UTC, positive when `then` is later. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * The fixture panel's heading, from the day its earliest fixture falls on.
 *
 * - Today → "Today".
 * - A Friday/Saturday/Sunday within the coming week → "This weekend".
 *   Six days, not two, so the board says "this weekend" from Monday
 *   onwards rather than only once the weekend has begun.
 * - Anything else (including preseason's eleven-day wait) → "Next up".
 * - Nothing scheduled at all → "Fixtures", a heading that claims nothing.
 */
export function fixturePanelHeading(firstDayIso: string | null, now: Date): string {
  if (!firstDayIso) return 'Fixtures';
  const today = now.toISOString().slice(0, 10);
  const delta = daysBetween(today, firstDayIso);
  if (delta <= 0) return 'Today';
  const weekday = new Date(`${firstDayIso}T00:00:00Z`).getUTCDay();
  if (delta <= 6 && WEEKEND_DAYS.has(weekday)) return 'This weekend';
  return 'Next up';
}

/**
 * The date range those fixtures actually cover — "Sat 16 Aug", or "Sat 16 —
 * Sun 17 Aug" when they span days. Always shown next to the heading, so
 * "This weekend" and "Next up" are never the only thing a reader has to go
 * on. The month is printed once when both ends share it.
 *
 * `days` is the grouped-by-day list the spine already renders, in
 * chronological order (`lib/site/spine.ts#groupFixturesByDay`); an empty
 * list has no range to state and returns `null` rather than a guess.
 */
export function fixtureDateRange(days: readonly { date: string }[]): string | null {
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  if (!first || !last) return null;
  const a = dayRailParts(first);
  if (first === last) return `${a.weekday} ${a.day} ${a.month}`;
  const b = dayRailParts(last);
  const start = a.month === b.month ? `${a.weekday} ${a.day}` : `${a.weekday} ${a.day} ${a.month}`;
  return `${start} — ${b.weekday} ${b.day} ${b.month}`;
}
