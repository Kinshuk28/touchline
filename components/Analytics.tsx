'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Traffic and a handful of named events (sign-in, squad saved, a league
 * created or joined — the server-side half of each lives at its call site,
 * via lib/site/analytics.ts), nothing else: no autocapture of clicks or
 * inputs, no session recording, Do Not Track honoured outright rather than
 * merely passed through as a flag for PostHog to decide about.
 *
 * Absent `NEXT_PUBLIC_POSTHOG_KEY`, this renders and does nothing —
 * analytics is opt-in infrastructure a deploy can simply not configure,
 * never a build requirement.
 *
 * Loaded with a plain, imperatively-injected `<script>` inside an effect,
 * not `next/script`'s declarative form. The Do Not Track check needs
 * `navigator`, which does not exist during server rendering; deciding
 * whether to load PostHog inside `useEffect` — which never runs on the
 * server — means that decision is made once, on the client, with the real
 * header available, rather than risking a mismatch between what the server
 * rendered and what a client with `DNT: 1` decides to render.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

interface PostHogClient {
  init: (key: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    posthog?: PostHogClient;
  }
}

function doNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { doNotTrack?: string; msDoNotTrack?: string };
  return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.msDoNotTrack === '1';
}

export function Analytics() {
  const pathname = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (!KEY || started.current || doNotTrack()) return;
    started.current = true;

    const script = document.createElement('script');
    script.src = `${HOST}/static/array.js`;
    script.async = true;
    script.onload = () => {
      window.posthog?.init(KEY, {
        api_host: HOST,
        // The three settings that keep this "minimal": no automatic
        // capture of every click and input, no recorded sessions, and
        // Do Not Track respected by the library itself too — belt and
        // braces alongside the check above, which stops the script from
        // ever loading at all when it's set.
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        respect_dnt: true,
        person_profiles: 'identified_only',
      });
      window.posthog?.capture('$pageview', { $current_url: window.location.href });
    };
    document.head.appendChild(script);
  }, []);

  // Next.js App Router navigations never reload the page, so PostHog's own
  // (disabled) pageview capture would never see them either way — each
  // route change is tracked by hand here instead.
  useEffect(() => {
    if (!started.current || !window.posthog) return;
    window.posthog.capture('$pageview', { $current_url: window.location.href });
    // `pathname` is the only dependency that should re-fire this — a
    // change in query string alone is not tracked, in keeping with
    // "minimal".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
