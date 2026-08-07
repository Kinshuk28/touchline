/**
 * Cookie names and options, in a module with no `next/headers` import.
 *
 * Middleware runs in the Edge runtime and cannot use `next/headers` — it
 * reads and writes cookies through the request and response objects instead.
 * Keeping these constants separate from `lib/auth/session.ts` is what lets
 * middleware.ts and the server-side session helpers agree on the same two
 * cookies without middleware pulling in a module it cannot run.
 */

export const ACCESS_COOKIE = 'tl-access';
export const REFRESH_COOKIE = 'tl-refresh';

/** An hour, matching Supabase's default access-token lifetime. */
export const ACCESS_MAX_AGE = 60 * 60;
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * `sameSite: 'lax'` is load-bearing, not a default: the magic link arrives
 * as a top-level navigation from the mail client, and `strict` would
 * withhold the cookies on exactly that request — the one where a manager has
 * just clicked through to their squad.
 *
 * `secure` is off only on plain HTTP, which in practice means a local dev
 * server; every deployed origin is HTTPS and gets the flag.
 */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
