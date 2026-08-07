import { NextResponse, type NextRequest } from 'next/server';
import { authClient, setSessionCookies } from '@/lib/auth/session';

/**
 * Turns a session that arrived in a URL fragment into this site's cookies.
 *
 * Only ever called by components/SessionBridge.tsx, and only when Supabase's
 * default email template delivered the tokens in the fragment rather than as
 * a `token_hash` (see app/auth/confirm/route.ts for why both shapes exist).
 *
 * TWO CHECKS, BOTH LOAD-BEARING.
 *
 * **Same origin.** An endpoint that accepts tokens and sets cookies is a
 * session-fixation target: given a cross-site POST, an attacker could log a
 * victim into the *attacker's* account and then read whatever the victim
 * does there. The cookies are `sameSite: lax`, which does not help — this is
 * a request that creates a session rather than one that uses it. So the
 * `Origin` header must match the host this request arrived on, and a request
 * with no `Origin` at all is refused rather than trusted.
 *
 * **The token must be real.** `getUser` asks Supabase to verify the
 * signature before anything is written to a cookie. Without it this route
 * would happily store any string, and every later request would carry a
 * token the database rejects — a signed-in-looking site with no data.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });
  }

  let body: { accessToken?: unknown; refreshToken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const accessToken = typeof body.accessToken === 'string' ? body.accessToken : null;
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : null;
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Missing tokens.' }, { status: 400 });
  }

  const { data, error } = await authClient().auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json({ error: 'That sign-in link is no longer valid.' }, { status: 401 });
  }

  await setSessionCookies({ accessToken, refreshToken });
  return NextResponse.json({ ok: true });
}
