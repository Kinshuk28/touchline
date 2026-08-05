/**
 * A table boundary: a hairline drawn between the row at `afterPosition` and
 * the row below it, with a small label — never colour alone (spec: "Mark
 * promotion and relegation boundaries with rules, not colour alone").
 */
export interface TableZone {
  /** The hairline sits between this position and the next one down. */
  afterPosition: number;
  label: string;
  kind: 'relegation' | 'relegation-playoff';
}

/**
 * Relegation-zone boundaries only, per competition (`fd_code`) — European
 * qualification lines (Champions League / Europa / Conference) are
 * deliberately not encoded here, at all, for any competition.
 *
 * Reasoning, per the spec's own instruction ("if you are not confident of a
 * competition's exact European allocation for this season, mark only the
 * relegation zone and say so"): this season's continental places are not a
 * fixed per-competition constant. England's Champions League allocation in
 * particular has varied with UEFA's coefficient-based extra berths, and
 * which cup-route/coefficient qualifiers apply for 2026-27 specifically is
 * not something this build can state with confidence. Rather than guess at
 * five competitions' worth of European qualification rules and risk
 * asserting a wrong one, none are asserted. See the direction-two-tables
 * report for the full reasoning.
 *
 * What *is* encoded is limited to relegation mechanics this build has
 * reasonable confidence in:
 *
 * - Premier League / La Liga / Serie A: flat three-team drop, no play-off.
 * - Bundesliga: bottom two (of 18) automatic; third-from-bottom (16th) is
 *   the relegation play-off spot against 2. Bundesliga's third-place team —
 *   a genuinely different mechanic from the other two, not just a third
 *   automatic slot, so it gets its own boundary and label.
 * - Ligue 1: marked as a single three-team "relegation zone" with no
 *   automatic/play-off split asserted. Ligue 1 shrank from 20 to 18 clubs
 *   in recent seasons and this build is not confident enough of the exact
 *   current split (how many automatic vs. play-off) to assert one — same
 *   reasoning as the European-lines omission above, applied to this one
 *   domestic mechanic instead of continental qualification.
 *
 * `teamCount` drives every boundary rather than a hardcoded "20" or "18",
 * so a competition that briefly runs at an unexpected size doesn't produce
 * a boundary with a negative or out-of-range `afterPosition`.
 */
export function relegationZones(fdCode: string, teamCount: number): TableZone[] {
  if (teamCount < 3) return [];

  switch (fdCode) {
    case 'PL':
    case 'PD':
    case 'SA':
      return [{ afterPosition: teamCount - 3, label: 'Relegation', kind: 'relegation' }];
    case 'BL1':
      return [
        { afterPosition: teamCount - 3, label: 'Relegation play-off', kind: 'relegation-playoff' },
        { afterPosition: teamCount - 2, label: 'Relegation', kind: 'relegation' },
      ];
    case 'FL1':
      return [{ afterPosition: teamCount - 3, label: 'Relegation zone', kind: 'relegation' }];
    default:
      return [];
  }
}

/**
 * Which zone (if any) a given table position falls inside — the cumulative
 * read of `relegationZones`' boundaries, used to give every row inside a
 * zone a subtle background tint in addition to the boundary hairline+label.
 * Later boundaries (higher `afterPosition`) override earlier ones for the
 * same position, which is exactly what makes Bundesliga's two-boundary case
 * resolve correctly: position 16 sits after only the first (play-off)
 * boundary, positions 17-18 sit after both and take the second (automatic)
 * boundary's kind.
 */
export function zoneKindForPosition(zones: readonly TableZone[], position: number): TableZone['kind'] | null {
  let result: TableZone['kind'] | null = null;
  for (const zone of zones) {
    if (position > zone.afterPosition) result = zone.kind;
  }
  return result;
}
