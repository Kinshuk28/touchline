// Deliberately below PostgREST's 1,000-row `max-rows` default, not equal to
// it. At exactly 1,000, a server-side drop of `max-rows` to (say) 500 would
// make every page come back short of `pageSize`, so the `page.length <
// pageSize` termination check would fire on the very first page and quietly
// truncate every result — reintroducing the exact data-loss bug this module
// was written to fix. 500 leaves headroom under any `max-rows` value this
// project is likely to run against.
const PAGE_SIZE = 500;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * PostgREST caps a plain `select` at 1,000 rows by default (its `max-rows`
 * setting). A single unpaginated select against a table that has grown past
 * that cap does not error — it just silently returns a truncated result set.
 * That is exactly how `getPlayerIdByFdId()` once returned a 1,000-entry map
 * for a 2,600-row `players` table, with no indication anything was missing.
 *
 * `fetchAllRows` pages through `fetchPage` with `.range(from, to)` until a
 * page comes back shorter than `pageSize`, collecting every row along the
 * way. Callers must apply a stable `.order(...)` on their query so that row
 * order — and therefore which rows land on which page — stays consistent
 * across the separate requests that make up one pagination run.
 *
 * `context` is prefixed onto any database error so callers keep the same
 * "which repository function failed" error behaviour they had before.
 */
export async function fetchAllRows<T>(
  context: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  // Sanity cap so a misbehaving page (e.g. a server that ignores `range` and
  // always returns a full page) can't spin forever. At `pageSize` rows per
  // page this allows 100M rows, far beyond anything this app will ever hold.
  const MAX_PAGES = 100_000;
  let pagesFetched = 0;

  for (;;) {
    if (pagesFetched >= MAX_PAGES) {
      throw new Error(`${context}: exceeded ${MAX_PAGES} pages while paginating — aborting to avoid a non-terminating loop`);
    }
    pagesFetched++;

    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(`${context}: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;

    // Advance by the number of rows actually received rather than assuming
    // `pageSize`, so a page that unexpectedly returns more rows than
    // requested still makes forward progress instead of looping forever.
    from += page.length;
  }

  return rows;
}
