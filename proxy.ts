import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, ACCESS_MAX_AGE, REFRESH_MAX_AGE, cookieOptions } from '@/lib/auth/cookies';
import { needsRefresh } from '@/lib/auth/jwt';

/**
 * Keeps a signed-in session alive.
 *
 * Next 16 renamed this file convention from `middleware.ts` to `proxy.ts`;
 * the behaviour is unchanged and this is still the request-lifecycle hook
 * that runs before a matched route is handled.
 *
 * Supabase access tokens last an hour. Something has to notice that one is
 * about to expire and exchange the refresh token for a new pair, and that
 * something cannot be a page: React Server Components may read cookies but
 * not write them, so a session could only ever be refreshed on the next
 * action a manager happened to take. They would be signed out mid-pick, an
 * hour into a session, with a squad half built.
 *
 * This is the one place in the request lifecycle that can both read the
 * expiring token and set the replacement, which is why this file exists and
 * why the refresh lives here rather than beside the rest of the auth code.
 *
 * WHY A BARE `fetch` AND NOT THE SUPABASE CLIENT. This runs in the Edge
 * runtime on every matched request. The refresh is one documented POST to
 * one endpoint; pulling the whole client in to make it would add startup
 * cost to every page load for a call that is four lines by hand.
 *
 * SCOPE. The matcher below deliberately covers only `/fantasy` — the only
 * part of the site that has ever heard of a user. Every other route is
 * anonymous, server-rendered and cacheable, and running this on them would
 * add latency to pages that will never read a session cookie.
 */

export const config = {
  matcher: ['/fantasy', '/fantasy/:path*'],
};

export default async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // Nothing to keep alive. Signed-out requests are the common case on these
  // routes and must not pay for a network call.
  if (!refreshToken) return NextResponse.next();
  if (accessToken && !needsRefresh(accessToken)) return NextResponse.next();

  const refreshed = await refresh(refreshToken);

  // A refresh token Supabase *rejected* means the session is over — signed
  // out elsewhere, revoked, or simply thirty days old. Clearing both cookies
  // turns that into a clean signed-out page rather than a signed-in-looking
  // page whose every query returns nothing.
  if (refreshed === 'rejected') {
    const response = NextResponse.next();
    response.cookies.set(ACCESS_COOKIE, '', cookieOptions(0));
    response.cookies.set(REFRESH_COOKIE, '', cookieOptions(0));
    return response;
  }

  // Could not reach Supabase at all. Leave the cookies exactly as they are
  // and let this request through: a network blip must not sign a manager out
  // of a squad they are halfway through picking. The page will render
  // signed-in and its queries may fail on the expired token, which is
  // recoverable; a cleared cookie is not.
  if (refreshed === 'unavailable') return NextResponse.next();

  // Set on the *request* as well as the response: this request is about to
  // be handled by a page that will read the cookie, and it must see the new
  // token rather than the expiring one it arrived with.
  request.cookies.set(ACCESS_COOKIE, refreshed.accessToken);
  request.cookies.set(REFRESH_COOKIE, refreshed.refreshToken);

  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(ACCESS_COOKIE, refreshed.accessToken, cookieOptions(ACCESS_MAX_AGE));
  response.cookies.set(REFRESH_COOKIE, refreshed.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  return response;
}

/**
 * Three outcomes, not two, because they call for different handling: a token
 * Supabase turned down is a finished session, and a request that never
 * arrived is not.
 */
type RefreshResult = { accessToken: string; refreshToken: string } | 'rejected' | 'unavailable';

async function refresh(refreshToken: string): Promise<RefreshResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  // Deliberately not `loadSiteEnv()`: a misconfigured environment must not
  // throw out of the proxy, which would take down every /fantasy route with
  // a 500 rather than degrading to a signed-out page.
  if (!url || !key) return 'unavailable';

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    // 4xx is Supabase saying no. 5xx is Supabase being unwell, and signing
    // everyone out over someone else's outage would be the wrong response.
    if (res.status >= 500) return 'unavailable';
    if (!res.ok) return 'rejected';
    const body = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!body.access_token || !body.refresh_token) return 'rejected';
    return { accessToken: body.access_token, refreshToken: body.refresh_token };
  } catch {
    return 'unavailable';
  }
}
