import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSiteEnv } from '@/lib/config/env';
import { decodeAccessToken } from '@/lib/auth/jwt';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from '@/lib/auth/cookies';

/**
 * Signed-in sessions, held in this site's own cookies.
 *
 * WHY NOT `@supabase/ssr`. That package exists to do exactly this, and it is
 * the obvious answer. It is also a new dependency, and this project has a
 * standing rule against adding those. What it actually provides is cookie
 * plumbing plus a PKCE code-verifier store; the magic-link flow below needs
 * neither, because `verifyOtp` exchanges a token hash for a session in one
 * server-side call with no verifier to persist. So the plumbing is here, in
 * about a hundred readable lines, rather than in a dependency.
 *
 * WHAT IS STORED. Two httpOnly cookies: the access token (short-lived, sent
 * to PostgREST as a bearer token) and the refresh token (long-lived, used
 * only by middleware.ts to mint a new access token). httpOnly means no
 * script on the page can read either, which is the point — this site runs no
 * third-party script, and that is a posture worth keeping enforceable rather
 * than merely true today.
 *
 * WHAT AUTHORISES. The access token is verified by Postgres, not here. See
 * lib/auth/jwt.ts for why nothing in this file's decoded claims is ever used
 * to decide what a user may see.
 */

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Session {
  userId: string;
  email: string | null;
  accessToken: string;
}

/**
 * The signed-in user, or `null`.
 *
 * Deliberately does not call Supabase to validate the token: that would be a
 * network round trip on every render to learn something the database checks
 * anyway on the next query. A forged cookie gets you a page that says your
 * own email address and then returns no rows, because RLS rejected the
 * signature.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  if (!accessToken) return null;

  const claims = decodeAccessToken(accessToken);
  if (claims === null || claims.sub === null) return null;

  return { userId: claims.sub, email: claims.email, accessToken };
}

/**
 * A Supabase client acting as the signed-in user.
 *
 * The access token goes in the `Authorization` header, which is what makes
 * PostgREST run the request as `authenticated` with `auth.uid()` set to this
 * user — and therefore what makes the row-level security policies in
 * supabase/migrations/0008 apply. Still the anon key: that key identifies
 * the project, the bearer token identifies the person.
 *
 * `persistSession: false` because this client is built per request and
 * discarded; the cookies above are the session store.
 */
export function userClient(accessToken: string): SupabaseClient {
  const env = loadSiteEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * An anonymous client whose only job is the auth endpoints — sending a magic
 * link and redeeming one. Separate from `lib/site/supabase.ts`'s cached
 * read client because that one is shared across requests and must not have
 * an auth state at all.
 */
export function authClient(): SupabaseClient {
  const env = loadSiteEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Writable only from a server action or route handler — Next.js forbids it during render. */
export async function setSessionCookies(tokens: SessionTokens): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE));
  store.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE));
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, '', cookieOptions(0));
  store.set(REFRESH_COOKIE, '', cookieOptions(0));
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
