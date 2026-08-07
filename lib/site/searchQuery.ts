/**
 * Turning a URL query string into something safe to hand PostgREST.
 *
 * Two separate hazards, both handled here rather than at the call site:
 *
 * 1. `ilike` wildcards. `%` and `_` are pattern operators, so a search for
 *    "50%" would otherwise match every club with "50" followed by anything.
 *    Escaped, not stripped — a reader searching for a literal underscore
 *    should find one.
 * 2. PostgREST filter syntax. Values embedded in an `.or()` string are
 *    delimited by commas and parentheses, so a query containing those
 *    characters can change the shape of the filter rather than the value
 *    inside it. lib/site/queries/search.ts avoids `.or()` entirely for that
 *    reason — one `.ilike()` per column, merged in JavaScript — and this
 *    module keeps the value tidy regardless.
 */

/** Below this, a search matches so much that it tells the reader nothing. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Longer than the longest stored club name (Borussia Mönchengladbach, 24)
 * with room to spare. A cap keeps a pathological URL from becoming a
 * pathological `ilike`.
 */
export const MAX_QUERY_LENGTH = 60;

/** Trimmed, inner whitespace collapsed, capped. Never null — an absent `?q=` is the empty string. */
export function normalizeSearchQuery(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

/** Whether a normalized query is worth running. */
export function isSearchable(query: string): boolean {
  return query.length >= MIN_QUERY_LENGTH;
}

/**
 * A `contains` pattern for `ilike`, with the pattern operators escaped so
 * they match themselves. Backslash first — escaping it after `%` and `_`
 * would double-escape the backslashes this function just added.
 */
export function likeContains(query: string): string {
  const escaped = query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/**
 * Ranks a result against the query — lower is better. An exact name beats a
 * prefix, a prefix beats a match buried in the middle, and shorter names
 * win ties, so searching "man" surfaces "Man City" and "Man United" above
 * "Manchester City FC"'s longer neighbours rather than in database order.
 *
 * Pure string work on already-fetched rows: the database does the matching,
 * this does the ordering, and neither invents a result the other didn't
 * find.
 */
export function matchRank(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  // Word-boundary hit ("United" in "Manchester United") ranks above one
  // inside a word ("ester" in "Manchester").
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 2;
  return 3;
}

/** Sorts by `matchRank`, then by name length, then alphabetically — a total order, so results never shuffle between renders. */
export function sortByRelevance<T>(items: readonly T[], query: string, nameOf: (item: T) => string): T[] {
  return items
    .slice()
    .sort((a, b) => {
      const nameA = nameOf(a);
      const nameB = nameOf(b);
      return (
        matchRank(nameA, query) - matchRank(nameB, query)
        || nameA.length - nameB.length
        || nameA.localeCompare(nameB)
      );
    });
}
