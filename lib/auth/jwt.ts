/**
 * Reading a Supabase access token *without verifying it*.
 *
 * THIS IS NOT AUTHORISATION, AND MUST NEVER BECOME IT.
 *
 * Nothing here checks a signature, so everything it returns is a claim the
 * bearer made about themselves. The only safe uses are the two below:
 *
 *   - deciding when to refresh (`exp`), where being lied to costs an
 *     unnecessary refresh and nothing else;
 *   - showing the signed-in address back to the person who typed it, where
 *     being lied to means someone forged a cookie to see their own email.
 *
 * Authorisation happens in exactly one place: Postgres. The token is sent to
 * PostgREST, which verifies its signature and sets `auth.uid()`, and the
 * row-level security policies in supabase/migrations/0008 decide what that
 * user may read and write. No code path anywhere reads `sub` from here and
 * uses it to fetch or write another user's rows — that is the whole reason
 * the writes are constrained in the database rather than in application
 * code.
 *
 * Pure and dependency-free so it runs unchanged in middleware (Edge), route
 * handlers and server components.
 */

export interface AccessTokenClaims {
  /** The Supabase user id. Display and logging only — never a query filter. */
  sub: string | null;
  email: string | null;
  /** Unix seconds. `null` when the token carries no expiry, which is treated as expired. */
  exp: number | null;
}

/**
 * Decode a JWT payload. Returns `null` for anything that is not a
 * well-formed three-part token with a decodable JSON payload — a corrupted
 * cookie is indistinguishable from no cookie, and both mean "signed out".
 */
export function decodeAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (payload === undefined || payload.length === 0) return null;

  let json: unknown;
  try {
    json = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;

  const claims = json as Record<string, unknown>;
  return {
    sub: typeof claims.sub === 'string' ? claims.sub : null,
    email: typeof claims.email === 'string' ? claims.email : null,
    exp: typeof claims.exp === 'number' ? claims.exp : null,
  };
}

/**
 * Should this token be exchanged for a fresh one?
 *
 * `skewSeconds` is a deliberate early refresh, not paranoia about clocks: a
 * token that passes this check and then expires during the request it was
 * checked for produces a signed-in page that fails to load its own data. A
 * minute of margin costs one extra refresh an hour.
 */
export function needsRefresh(token: string, now: Date = new Date(), skewSeconds = 60): boolean {
  const claims = decodeAccessToken(token);
  if (claims === null || claims.exp === null) return true;
  return claims.exp - skewSeconds <= Math.floor(now.getTime() / 1000);
}

/**
 * Base64url → string, without Node's Buffer, so this works in middleware's
 * Edge runtime too. `atob` yields one byte per character; decoding those
 * bytes as UTF-8 is what keeps a non-ASCII email address intact.
 */
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
