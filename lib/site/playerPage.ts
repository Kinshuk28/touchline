import type { PlayerSeasonStats } from '@/lib/site/queries/players';

/**
 * Age in whole years from a stored `date_of_birth`, or `null` when the
 * column is null (common) or unparseable. Never an approximation from a
 * season or a squad number — an age this app can't derive exactly is an age
 * it doesn't print.
 */
export function ageFrom(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  // Birthday hasn't happened yet this year.
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

/**
 * Whether a stats row carries anything worth a table row. `player_season_stats`
 * is written by two jobs with different coverage, so a row can exist with
 * every metric null — an FPL row for a player who has not been in a squad,
 * for instance. Rendering that is a line of em dashes pretending to be data.
 */
export function hasAnyStat(row: PlayerSeasonStats): boolean {
  return [row.appearances, row.minutes, row.goals, row.assists, row.yellow_cards, row.red_cards]
    .some((v) => v !== null);
}

/**
 * Stats for display: rows with nothing in them dropped, newest season
 * first, and within a season `football-data` before `fpl`.
 *
 * That source order is not arbitrary. football-data.org's scorer tables are
 * the provider this site's fixtures, standings and clubs all come from, so
 * its row is the one that agrees with the rest of the page; the FPL row is
 * supplementary and covers only the Premier League. Both are shown — see
 * `PlayerSeasonStats` for why they are never merged — but the primary
 * source leads.
 */
export function displayStats(rows: readonly PlayerSeasonStats[]): PlayerSeasonStats[] {
  return rows
    .filter(hasAnyStat)
    .slice()
    .sort((a, b) => (b.season - a.season) || a.source.localeCompare(b.source));
}
