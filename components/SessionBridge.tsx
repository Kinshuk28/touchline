'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Completes a sign-in whose session arrived in the URL fragment.
 *
 * Supabase's default magic-link template sends the tokens as
 * `#access_token=...&refresh_token=...`. A fragment is never transmitted to
 * a server, so no amount of server code can see it — this is the one job on
 * the site that genuinely requires a browser, and it exists so that sign-in
 * works on a Supabase project with the stock email template rather than
 * failing with "invalid link". Configure the `token_hash` template (see the
 * Phase C spec) and this component never runs at all.
 *
 * It hands the tokens to /auth/session, which verifies them with Supabase
 * before storing anything, and clears the fragment from the address bar so
 * the tokens do not sit in browser history or get pasted into a chat window
 * along with the URL.
 */
export function SessionBridge() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return;

    // Out of the address bar before the network call, not after: if the
    // request is slow, the tokens should not be sitting in a visible URL in
    // the meantime.
    window.history.replaceState(null, '', window.location.pathname);
    setState('working');

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken, refreshToken }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setState('failed');
          return;
        }
        router.replace('/fantasy');
        router.refresh();
      } catch {
        if (!cancelled) setState('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === 'idle') return null;

  return (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2 text-13 ${
        state === 'failed' ? 'border-border bg-surface-2 text-text' : 'border-border bg-surface text-muted'
      }`}
    >
      {state === 'working'
        ? 'Signing you in…'
        : 'That sign-in link is no longer valid. Ask for a new one below.'}
    </p>
  );
}
