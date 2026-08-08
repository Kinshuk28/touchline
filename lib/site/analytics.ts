/**
 * Server-side analytics: a small number of named events fired from the
 * server actions and route handlers that already do them for real — signing
 * in, saving a squad, creating or joining a league. See
 * components/Analytics.tsx for the client-side pageview half.
 *
 * A plain `fetch` to PostHog's capture endpoint, not the `posthog-node`
 * package — this project adds no new dependency for analytics any more than
 * it does anywhere else in its auth or data layer, and a capture call is one
 * JSON POST with no SDK behind it.
 *
 * Opt-in: absent `NEXT_PUBLIC_POSTHOG_KEY` this is a no-op everywhere it is
 * called, so a deploy with no PostHog project configured behaves exactly as
 * it did before analytics existed.
 *
 * Never allowed to break the feature it is watching. Every failure — no key
 * configured, PostHog unreachable, a malformed response — is swallowed. A
 * dropped analytics event is invisible; a squad that failed to save because
 * an analytics vendor's network hiccuped would not be.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export async function trackServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!KEY) return;
  try {
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: distinctId,
        properties,
      }),
    });
  } catch {
    // See the module comment — analytics failures are never surfaced.
  }
}
