import { NextResponse, type NextRequest } from 'next/server';
import { authClient, setSessionCookies } from '@/lib/auth/session';
import { trackServerEvent } from '@/lib/site/analytics';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Where a magic link lands.
 *
 * Supabase can deliver a magic link in either of two shapes, and which one
 * arrives depends on a template in the project's dashboard. This route
 * handles the good one and redirects the other to a fallback that can:
 *
 *   1. **`?token_hash=...`** — the server-side shape. The hash is a
 *      single-use handle, redeemed here with `verifyOtp`, and the session
 *      never touches the browser's URL at all. This is what the template
 *      documented in docs/superpowers/specs/2026-08-07-fantasy-phase-c.md
 *      produces, and it is the path to prefer.
 *
 *   2. **`#access_token=...`** — Supabase's default template, which sends
 *      the session itself in the URL fragment. Fragments are never sent to a
 *      server, so this handler cannot see one; it redirects to the sign-in
 *      page, where a small client component hands the tokens back over a
 *      POST. Browsers carry a fragment across a redirect whose target has
 *      none, which is what makes that work.
 *
 * Supporting both means sign-in works on a Supabase project with nothing
 * configured beyond the redirect allow-list, and gets quietly better when
 * the template is updated. A single-shape implementation would have failed
 * with "invalid link" on a fresh project and looked like a bug in this code.
 */

// A magic link is a one-time credential; nothing about this response may be
// stored or replayed.
export const dynamic = 'force-dynamic';

/** The `type` values a magic link can legitimately carry. */
const OTP_TYPES = new Set<EmailOtpType>(['magiclink', 'email', 'signup', 'recovery', 'invite', 'email_change']);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const rawType = url.searchParams.get('type');

  // No token_hash: either the default-template link (session in the
  // fragment, invisible here) or someone typing the URL. Both are answered
  // by the sign-in page — the bridge completes the first and the form
  // handles the second.
  if (!tokenHash) {
    return NextResponse.redirect(new URL('/fantasy/sign-in?bridge=1', request.url));
  }

  const type: EmailOtpType = OTP_TYPES.has(rawType as EmailOtpType) ? (rawType as EmailOtpType) : 'magiclink';

  const { data, error } = await authClient().auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.session) {
    // Deliberately one message for every failure. Expired, already used and
    // never valid are the same event to the person holding the link, and
    // distinguishing them out loud tells an attacker which guesses landed.
    return NextResponse.redirect(new URL('/fantasy/sign-in?error=link', request.url));
  }

  await setSessionCookies({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
  await trackServerEvent('signed_in', data.session.user.id, { method: 'magic_link' });

  return NextResponse.redirect(new URL('/fantasy', request.url));
}
