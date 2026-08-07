'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authClient, clearSessionCookies } from '@/lib/auth/session';
import { loadSiteEnv } from '@/lib/config/env';

/**
 * Sending and ending sessions.
 *
 * Magic links, not passwords: there is no password to store, leak, reuse or
 * reset, and the whole account surface of this site is one email address.
 * That is a deliberately small thing to be responsible for.
 */

const emailSchema = z.string().trim().toLowerCase().email('That does not look like an email address.');

export interface SignInState {
  status: 'idle' | 'sent' | 'error';
  message: string;
  /** Echoed back so a rejected form does not make someone retype their address. */
  email: string;
}

export async function sendMagicLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const raw = String(formData.get('email') ?? '');
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Enter an email address.', email: raw };
  }
  const email = parsed.data;

  const { error } = await authClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
  });

  if (error) {
    // Rate limiting is the one failure worth naming, because the fix is
    // "wait" and a generic message would have someone retrying into a longer
    // lockout.
    const message = error.status === 429
      ? 'Too many sign-in emails just now. Try again in a few minutes.'
      : 'Could not send that email. Try again in a moment.';
    return { status: 'error', message, email };
  }

  // Deliberately the same response whether or not an account exists. Supabase
  // creates one on first sign-in anyway, and a form that says "no such
  // account" is a form that confirms which addresses are registered.
  return {
    status: 'sent',
    message: `Check ${email} for a sign-in link. It works once and expires in an hour.`,
    email,
  };
}

/**
 * The link that starts a Google sign-in.
 *
 * Not a fetch and not a Supabase client call — `/auth/v1/authorize` is a
 * plain GET endpoint that runs the whole OAuth handshake with Google itself
 * and only redirects back here at the end, so this is nothing more than a
 * URL to send the browser to. That is what keeps Google sign-in out of the
 * "new dependency" problem magic links already solved: no browser-side
 * Supabase client, no OAuth library, just a link.
 *
 * On success it lands back on `/auth/confirm` with the session in the URL
 * fragment (`#access_token=...`) — the same shape Supabase's stock
 * magic-link template produces, which app/auth/confirm/route.ts already
 * forwards to components/SessionBridge.tsx. One fallback path serves both
 * doors in; nothing new had to be built to receive this.
 */
export async function googleSignInHref(): Promise<string> {
  const env = loadSiteEnv();
  const redirectTo = `${await siteOrigin()}/auth/confirm`;
  const url = new URL('/auth/v1/authorize', env.SUPABASE_URL);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

export async function signOut(): Promise<void> {
  await clearSessionCookies();
  redirect('/fantasy/sign-in');
}

/**
 * The origin to send people back to, read from the request rather than
 * configured.
 *
 * A hardcoded or env-var origin is wrong on at least one of production,
 * deploy previews and localhost, and being wrong here means a sign-in link
 * that lands on the wrong site. The host header is what the browser actually
 * asked for, which is by definition the right answer.
 *
 * Supabase still refuses any `emailRedirectTo` outside the project's
 * redirect allow-list, so a forged Host header cannot redirect a link
 * somewhere else — that check lives with the party issuing the token, which
 * is where it belongs.
 */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
