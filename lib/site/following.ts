/**
 * Read/write helpers for the `touchline-following` cookie — a strictly
 * functional preference (which competitions to default the landing ticker
 * and /scores to) with no tracking, no identifiers and no third parties, so
 * it needs no consent banner. See the redesign spec's "Following (cookie)"
 * section.
 *
 * `localStorage` cannot be read on the server, which is the entire reason
 * this is a cookie: it lets a server component render the user's
 * preference on first paint with no flash. Server reads go through
 * `next/headers`' `cookies()`; the client (components/FollowToggle.tsx)
 * reads/writes `document.cookie` directly, funnelled through the same
 * `parseFollowingCookie`/`serializeFollowingCookie` pair so the two never
 * disagree about the format.
 */

export const FOLLOWING_COOKIE_NAME = 'touchline-following';

/** One year, in seconds — the `Max-Age` the spec calls for. */
export const FOLLOWING_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A league code looks like `PL`, `PD`, `SA`, `BL1`, `FL1` — 2-4 upper-case alphanumerics. Anything else in the cookie is dropped rather than trusted. */
const CODE_PATTERN = /^[A-Z0-9]{2,4}$/;

/**
 * Parses a `touchline-following` cookie value into league codes. Defensive
 * against every kind of malformed input this cookie could ever hold — a
 * value hand-edited in devtools, a stray `%` that isn't a valid escape, an
 * empty string, `undefined`/`null` for "no cookie set" — because a parse
 * failure here must never crash a page render. Any exception is caught and
 * yields an empty list, exactly like an absent cookie; never a partial
 * result salvaged from whatever did parse.
 */
export function parseFollowingCookie(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const decoded = decodeURIComponent(raw);
    return decoded
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => CODE_PATTERN.test(code));
  } catch {
    return [];
  }
}

/**
 * The inverse of `parseFollowingCookie`: league codes -> a cookie-safe
 * value. Dedupes and silently drops anything that wouldn't round-trip back
 * through `parseFollowingCookie` (never writes a value its own parser
 * couldn't read back).
 */
export function serializeFollowingCookie(codes: string[]): string {
  const clean = Array.from(new Set(codes.map((code) => code.trim().toUpperCase())))
    .filter((code) => CODE_PATTERN.test(code));
  return encodeURIComponent(clean.join(','));
}

/**
 * Adds `code` to `current` if absent, removes it if present. Extracted as a
 * pure function so components/FollowToggle.tsx's click handler is a thin
 * read-toggle-write and this decision is unit-testable on its own.
 */
export function toggleFollowingCode(current: string[], code: string): string[] {
  const upper = code.trim().toUpperCase();
  return current.includes(upper) ? current.filter((c) => c !== upper) : [...current, upper];
}

/**
 * Server-side read via `next/headers`. Not unit-tested directly (it needs
 * the Next.js request context) — the parsing it delegates to is what
 * tests/site/following.test.ts covers. Imported lazily so that merely
 * importing this module (e.g. from a unit test that only wants
 * `parseFollowingCookie`) never pulls in Next's server-only request APIs.
 */
export async function getFollowingLeagues(): Promise<string[]> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return parseFollowingCookie(store.get(FOLLOWING_COOKIE_NAME)?.value ?? null);
}
