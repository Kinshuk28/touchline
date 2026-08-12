import type { PlayerSeasonStats } from '@/lib/site/queries/players';
import type { NewsRow } from '@/lib/site/rows';

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

/** Lower-case, diacritic-stripped word tokens — "Müller" and "Muller" both become `muller`. */
function tokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether a headline names this player — checked on the last word of their
 * stored name (their surname, for the "First Last" shape every stored name
 * has), not the full string. A byline almost never spells out a full name
 * ("Bellingham nets late winner", not "Jude Bellingham nets late winner"),
 * so requiring the whole thing would miss the headlines that actually exist.
 * A multi-word surname ("Van Dijk", "De Bruyne") still matches correctly on
 * just its own last word, since that word is present in the headline
 * whenever the full surname is.
 *
 * Whole-word only, like `lib/site/newsRelevance.ts`'s club matcher — no
 * substring test — and skipped entirely for a surname under three
 * characters, short enough to collide with an ordinary word too often to be
 * worth the false positives (there is no stored name this short today, but
 * nothing stops one arriving).
 */
export function mentionsPlayer(title: string, playerName: string): boolean {
  const nameTokens = tokens(playerName);
  const surname = nameTokens.at(-1);
  if (!surname || surname.length < 3) return false;
  return tokens(title).includes(surname);
}

/**
 * A player's own stories first, the rest of their club's news after — never
 * an empty panel when the club has news at all, even if none of it happens
 * to name this player by surname. `limit` caps the combined result, same
 * shape `orderByRelevance` (lib/site/newsRelevance.ts) already uses
 * elsewhere: newest-first within each tier, tiers concatenated.
 */
export function playerNewsFirst(clubNews: readonly NewsRow[], playerName: string, limit: number): NewsRow[] {
  const mentioned: NewsRow[] = [];
  const rest: NewsRow[] = [];
  for (const item of clubNews) (mentionsPlayer(item.title, playerName) ? mentioned : rest).push(item);
  return [...mentioned, ...rest].slice(0, limit);
}
