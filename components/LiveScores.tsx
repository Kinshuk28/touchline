'use client';

import { useEffect, useRef, useState } from 'react';
import { ScoreRow } from '@/components/ScoreRow';
import { DataAge } from '@/components/DataAge';
import { mergeLiveFixtures, hasLiveChanges, parseLiveResponse, type LiveApiResponse } from '@/lib/site/livePatch';
import { scoreCellText } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams } from '@/lib/site/rows';

// The ingest job (scripts/ingest/live.ts, run on the schedule in
// .github/workflows/ingest-live.yml) writes every 5 minutes. Polling much
// faster than that just re-reads rows that haven't changed; 2 minutes stays
// comfortably fresher than the write cadence while halving request/DB-read
// volume versus the previous 60s interval.
const POLL_MS = 120_000;

function liveUrl(leagues: string[]): string {
  return leagues.length > 0 ? `/api/live?leagues=${leagues.join(',')}` : '/api/live';
}

async function fetchLive(url: string): Promise<LiveApiResponse | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    // A structurally malformed-but-valid body (client/server skew during a
    // rolling deploy) must be ignored exactly like a failed request, not
    // thrown at mergeLiveFixtures — see lib/site/livePatch.ts#parseLiveResponse.
    return parseLiveResponse(await res.json());
  } catch {
    // A failed poll is not worth disturbing the page for; the next one retries.
    return null;
  }
}

export function LiveScores({
  initial, nowIso, leagues = [], leagueIds,
}: {
  initial: FixtureWithTeams[];
  nowIso: string;
  /** League codes selected by the page's own filter, in the same `?leagues=` format. Carried into every poll so the league filter survives live updates (Finding 1). */
  leagues?: string[];
  /** Numeric ids for the same selection, used as a defensive backstop in mergeLiveFixtures. `undefined` means no filter. */
  leagueIds?: number[];
}) {
  const [fixtures, setFixtures] = useState(initial);
  const [stamp, setStamp] = useState(nowIso);
  // Mirrors `fixtures` so `poll` always compares against the latest merged
  // result without needing a stale closure or a functional setState update
  // (which would have to perform the hasLiveChanges side effect from inside
  // an updater — polls here are always sequential, never concurrent, so a
  // plain ref is enough).
  const fixturesRef = useRef(initial);
  const url = liveUrl(leagues);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const body = await fetchLive(url);
      if (cancelled || !body) return;

      const merged = mergeLiveFixtures(fixturesRef.current, body.fixtures, leagueIds);
      // Only update state when something actually changed: a no-op poll
      // (by far the common case at a 120s cadence) must cause zero
      // re-renders, not push a fresh `now` through every row regardless of
      // identity. See lib/site/livePatch.ts#hasLiveChanges.
      if (!hasLiveChanges(fixturesRef.current, merged)) return;

      fixturesRef.current = merged;
      setFixtures(merged);
      setStamp(body.now);
    }

    function start() {
      if (intervalId !== null) return;
      intervalId = setInterval(poll, POLL_MS);
    }

    function stop() {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    }

    // Pause polling while the tab is hidden or backgrounded — no point
    // hitting /api/live every couple of minutes forever for nobody. Resume
    // with an immediate fetch when the user comes back, so they see current
    // scores right away rather than waiting out the interval.
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        start();
        void poll();
      }
    }

    // Poll once immediately rather than waiting a full POLL_MS: this effect
    // re-runs on every mount, and thanks to the `key` app/scores/page.tsx
    // now puts on <LiveScores> (Finding 2), a filter change is a mount —
    // without an immediate poll here, switching filters would still show
    // the correct *server-rendered* `initial` for the new selection, but
    // then sit on it for up to two minutes before the panel could reflect
    // anything that changed since that render. This only ever fires from
    // mount, and `handleVisibilityChange`'s own immediate poll only ever
    // fires from a later `visibilitychange` event, so the two cannot
    // double-fire against each other.
    if (document.visibilityState !== 'hidden') {
      start();
      void poll();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [url, leagueIds]);

  const now = new Date(stamp);
  const newest = fixtures.reduce<string | null>(
    (acc, f) => (acc === null || f.updated_at > acc ? f.updated_at : acc), null);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Live &amp; recent</h2>
        {newest && <DataAge updatedAt={newest} now={now} />}
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {fixtures.map((f) => <ScoreRow key={f.id} fixture={f} scoreText={scoreCellText(f, now)} />)}
      </ul>
    </section>
  );
}
