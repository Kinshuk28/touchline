import type { FixtureWithTeams } from '@/lib/site/rows';

/** The minimal shape /api/live returns — scores and status, nothing joined. */
export interface LivePatch {
  id: number;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  updated_at: string;
}

/**
 * Returns a new array only where something actually changed. Unchanged
 * fixtures keep their original object identity so React skips re-rendering
 * those rows — that is what keeps scroll position and open state intact
 * when a goal lands.
 */
export function applyPatches(
  current: FixtureWithTeams[],
  patches: LivePatch[],
): FixtureWithTeams[] {
  if (patches.length === 0) return current;
  const byId = new Map(patches.map((p) => [p.id, p]));
  return current.map((f) => {
    const p = byId.get(f.id);
    if (!p) return f;
    if (p.status === f.status && p.home_goals === f.home_goals && p.away_goals === f.away_goals) return f;
    return {
      ...f,
      status: p.status,
      home_goals: p.home_goals,
      away_goals: p.away_goals,
      updated_at: p.updated_at,
    };
  });
}
