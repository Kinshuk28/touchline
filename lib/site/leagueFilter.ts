import type { LeagueRow } from '@/lib/site/rows';

/**
 * Parses a `leagues=PD,SA` query value into league codes. This is exactly
 * the rule `/scores` applies to its own `?leagues=` search param, factored
 * out so `/api/live` uses the identical rule rather than a hand-rolled copy
 * that could quietly drift from it. An absent or empty value means "no
 * filter, show everything" — both here and in the caller.
 */
export function parseLeagueCodes(raw: string | null | undefined): string[] {
  return raw ? raw.split(',').filter(Boolean) : [];
}

/**
 * Resolves league codes to ids. A code with no matching league is dropped,
 * not substituted for "match everything" — so a `codes` list made entirely
 * of unrecognised codes resolves to `[]`. Callers MUST treat an empty
 * result as "match nothing" when `codes` was non-empty; silently widening
 * an unrecognised filter to "everything" is exactly the bug this function
 * exists to prevent (see Finding 1: `/api/live` must agree with `/scores`
 * about what an unknown league code means).
 */
export function resolveLeagueIds(leagues: LeagueRow[], codes: string[]): number[] {
  const byCode = new Map(leagues.map((l) => [l.fd_code, l.id]));
  return codes.reduce<number[]>((ids, code) => {
    const id = byCode.get(code);
    if (id !== undefined) ids.push(id);
    return ids;
  }, []);
}

/**
 * The pure href logic behind `<LeagueFilter>`'s pills — extracted here,
 * alongside `parseLeagueCodes`/`resolveLeagueIds`, so it can be unit-tested
 * without a DOM (Finding 3: this toggle logic used to live inline inside
 * `components/LeagueFilter.tsx`, a component with no test at all).
 *
 * `code === null` is the "All" pill: it always resets to the bare
 * `basePath`, regardless of the current selection. For a real code, it
 * toggles the selection: adds it if not already present, removes it if it
 * is — and removing the last remaining code collapses back to the bare
 * `basePath` rather than leaving a dangling `?leagues=` with nothing in it.
 */
export function hrefForLeagueFilter(basePath: string, selected: string[], code: string | null): string {
  if (code === null) return basePath;
  const next = selected.includes(code)
    ? selected.filter((c) => c !== code)
    : [...selected, code];
  return next.length === 0 ? basePath : `${basePath}?leagues=${next.join(',')}`;
}
