'use client';

import { useEffect, useState } from 'react';
import { ScoreRow } from '@/components/ScoreRow';
import { DataAge } from '@/components/DataAge';
import { applyPatches, type LivePatch } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const POLL_MS = 60_000;

export function LiveScores({ initial, nowIso }: { initial: FixtureWithTeams[]; nowIso: string }) {
  const [fixtures, setFixtures] = useState(initial);
  const [stamp, setStamp] = useState(nowIso);

  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { now: string; fixtures: LivePatch[] };
        if (cancelled) return;
        setFixtures((prev) => applyPatches(prev, body.fixtures));
        setStamp(body.now);
      } catch {
        /* A failed poll is not worth disturbing the page for; the next one retries. */
      }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
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
