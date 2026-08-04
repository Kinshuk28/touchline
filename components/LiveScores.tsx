'use client';

import { useEffect, useState } from 'react';
import { ScoreRow } from '@/components/ScoreRow';
import { DataAge } from '@/components/DataAge';
import { mergeLiveFixtures } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

// The ingest job (scripts/ingest/live.ts, run on the schedule in
// .github/workflows/ingest-live.yml) writes every 5 minutes. Polling much
// faster than that just re-reads rows that haven't changed; 2 minutes stays
// comfortably fresher than the write cadence while halving request/DB-read
// volume versus the previous 60s interval.
const POLL_MS = 120_000;

interface LiveResponse {
  now: string;
  fixtures: FixtureWithTeams[];
}

async function fetchLive(): Promise<LiveResponse | null> {
  try {
    const res = await fetch('/api/live', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as LiveResponse;
  } catch {
    // A failed poll is not worth disturbing the page for; the next one retries.
    return null;
  }
}

export function LiveScores({ initial, nowIso }: { initial: FixtureWithTeams[]; nowIso: string }) {
  const [fixtures, setFixtures] = useState(initial);
  const [stamp, setStamp] = useState(nowIso);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const body = await fetchLive();
      if (cancelled || !body) return;
      setFixtures((prev) => mergeLiveFixtures(prev, body.fixtures));
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

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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
        {fixtures.map((f) => <ScoreRow key={f.id} fixture={f} now={now} />)}
      </ul>
    </section>
  );
}
