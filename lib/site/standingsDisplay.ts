import type { StandingRow } from '@/lib/site/rows';

/**
 * `standings.season` stores the campaign's *starting* year (2025 for the
 * completed 2025-26 season, 2026 for the 2026-27 season that starts
 * 2026-08-16). Every place a season needs a human label goes through this
 * one function so "2025-26" is never hand-built or typo'd differently in
 * two places.
 */
export function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * A season with no matches played yet — every row's `played` is 0. This is
 * a data check, not a calendar one: it asks the rows themselves rather than
 * comparing dates, so it stays correct even if a season's start date slips
 * or this runs mid-way through matchday 1 for some leagues and not others.
 * An empty `rows` array is *not* unplayed by this definition (there is
 * nothing to be honestly-zeroed) — callers with `rows.length === 0` should
 * handle "no data" as its own case rather than reading this as `false` and
 * treating it as a played season.
 */
export function isUnplayedSeason(rows: readonly StandingRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.played === 0);
}

/**
 * Table row order for display. A played (or in-progress) season sorts by
 * the stored `position` — that column is the real ranking. An unplayed
 * season's stored `position` is an ingestion artifact (verified against the
 * live table: it is neither alphabetical nor stable in any football sense),
 * so presenting it as a ranking would be exactly the "table of zeros
 * presented as live standings" the spec says never to do. Sorting those
 * rows alphabetically by club name instead is an honest, non-ranking order
 * — obviously not a table, just a list.
 */
export function sortStandingsForDisplay(rows: readonly StandingRow[]): StandingRow[] {
  const copy = [...rows];
  if (isUnplayedSeason(rows)) {
    return copy.sort((a, b) => (a.team?.name ?? '').localeCompare(b.team?.name ?? ''));
  }
  return copy.sort((a, b) => a.position - b.position);
}

/** Goal difference with an explicit `+` for positive values — standard football notation. */
export function formatGoalDifference(gd: number): string {
  return gd > 0 ? `+${gd}` : `${gd}`;
}

/**
 * Parses `standings.form` ("W,D,L,W,W", oldest-to-most-recent) into an
 * array of result letters, or `null` if there is nothing to show. Null and
 * `''` both come back `null` — the live table stores `''` for the 96
 * not-yet-played rows, not `null`, so both must be treated as "absent"
 * rather than only checking for `null` (see the spec's "check whether form
 * is actually populated before designing around it"). A token outside
 * `W`/`D`/`L` is dropped rather than rendered as-is or guessed at — real
 * provider data never produces one, but a caller must not invent a result
 * letter if it ever did.
 */
export function parseForm(form: string | null | undefined): Array<'W' | 'D' | 'L'> | null {
  if (!form) return null;
  const letters = form
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is 'W' | 'D' | 'L' => s === 'W' || s === 'D' || s === 'L');
  return letters.length > 0 ? letters : null;
}
