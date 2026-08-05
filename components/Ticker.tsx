'use client';

import { useEffect, useRef, useState } from 'react';
import { getCompetitionMeta } from '@/lib/site/competition';
import { formatPreciseCountdown, precisePartsOf } from '@/lib/site/countdown';
import { mergeLiveFixtures, hasLiveChanges, parseLiveResponse, type LiveApiResponse } from '@/lib/site/livePatch';
import { scoreCellText } from '@/lib/site/scoreDisplay';
import { spineStateLabel } from '@/lib/site/spine';
import type { FixtureWithTeams, LeagueRow } from '@/lib/site/rows';

export interface PendingKickoff {
  league: LeagueRow;
  kickoffUtc: string;
}

// Same cadence and reasoning as components/LiveScores.tsx: the ingest job
// writes every 5 minutes, so polling faster than 2 minutes just re-reads
// rows that have not changed.
const POLL_MS = 120_000;

async function fetchLive(url: string): Promise<LiveApiResponse | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseLiveResponse(await res.json());
  } catch {
    // A failed poll is not worth disturbing the page for; the next retries.
    return null;
  }
}

/**
 * The landing page's single-line ticker strip. Two modes, chosen by which
 * data is non-empty rather than by a literal "is the season live" flag
 * (there is no such flag — an empty live list is what preseason *is*, and
 * it is also what a goalless midweek gap looks like once the season is
 * under way):
 *
 * - anything live or just-finished: one item per fixture, mono score.
 * - otherwise: one item per competition with a still-to-come kickoff, and a
 *   countdown that actually counts down.
 *
 * IT IS ALIVE ON PURPOSE. This was a server-rendered snapshot: the countdown
 * was baked at render time and then sat there, and a score only moved if you
 * reloaded. Both were the same complaint — the page looked stale because it
 * was stale. Now:
 *
 * - the countdown ticks once a second off the browser's own clock;
 * - `/api/live` is polled every two minutes, so a kickoff, a goal or a
 *   full-time whistle reaches the strip on its own, and it flips from
 *   countdown mode to score mode the moment the first match starts.
 *
 * Neither invents anything: the countdown is arithmetic on a stored kickoff
 * time, and the scores are the same rows `/scores` serves.
 *
 * Hydration: the first client render reproduces the server's output exactly
 * (`serverNowMs`, and `live` as the initial fixtures), and ticking only
 * starts after mount — see `clientNowMs` below — so there is no mismatch to
 * reconcile.
 *
 * `overflow-x-auto` on a `min-w-max` row (never `flex-wrap`) is what keeps
 * this to one line at any width down to 360px.
 */
export function Ticker({
  live, pending, leagues, now,
}: {
  live: FixtureWithTeams[];
  pending: PendingKickoff[];
  leagues: LeagueRow[];
  now: Date;
}) {
  const serverNowMs = now.getTime();
  const [fixtures, setFixtures] = useState(live);
  // `null` until mounted: the first client render must match the server's,
  // which used `now`. Every read below falls back to `serverNowMs`, so the
  // markup is identical until the first tick replaces it.
  const [clientNowMs, setClientNowMs] = useState<number | null>(null);
  // Whether the reader asked for reduced motion. Starts `false` so the first
  // client render matches the server's, and is corrected on mount alongside
  // the first tick — see the effect below.
  const [calm, setCalm] = useState(false);
  const fixturesRef = useRef(live);

  // The tick. One interval for the whole strip, not one per countdown.
  //
  // `prefers-reduced-motion` turns it down rather than off: a digit changing
  // every second is exactly the kind of restless, unstoppable movement that
  // preference is asking us to stop, but a countdown that never updates at
  // all is the staleness this component exists to fix. So a reduced-motion
  // reader gets the calm day/hour form, refreshed once a minute — the same
  // thing <Countdown> shows everywhere else on the site.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let id: ReturnType<typeof setInterval> | null = null;

    function apply() {
      if (id !== null) clearInterval(id);
      setCalm(query.matches);
      setClientNowMs(Date.now());
      id = setInterval(() => setClientNowMs(Date.now()), query.matches ? 60_000 : 1000);
    }

    apply();
    query.addEventListener('change', apply);
    return () => {
      if (id !== null) clearInterval(id);
      query.removeEventListener('change', apply);
    };
  }, []);

  // The poll. Paused while the tab is hidden, with an immediate catch-up
  // fetch on return — same shape as components/LiveScores.tsx, for the
  // reasons documented there.
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const body = await fetchLive('/api/live');
      if (cancelled || !body) return;
      const merged = mergeLiveFixtures(fixturesRef.current, body.fixtures);
      // A no-op poll — the common case — must cause no re-render at all.
      if (!hasLiveChanges(fixturesRef.current, merged)) return;
      fixturesRef.current = merged;
      setFixtures(merged);
    }

    function start() {
      if (intervalId === null) intervalId = setInterval(poll, POLL_MS);
    }
    function stop() {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') { stop(); return; }
      start();
      void poll();
    }

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (fixtures.length === 0 && pending.length === 0) return null;

  const tickNow = new Date(clientNowMs ?? serverNowMs);
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  return (
    <div
      className="overflow-x-auto border-b border-border"
      aria-label={fixtures.length > 0 ? 'Live scores' : 'Season countdown by competition'}
    >
      <ul className="flex min-w-max items-center gap-5 whitespace-nowrap px-1 py-2">
        {fixtures.length > 0 && fixtures.map((f) => {
          const league = leagueById.get(f.league_id);
          const comp = getCompetitionMeta(league?.fd_code ?? '');
          const state = spineStateLabel(f);
          return (
            <li key={f.id} className="flex shrink-0 items-center gap-2 text-13">
              <span className={`size-1.5 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
              <span className="sr-only">{comp.name}</span>
              <span className="font-mono font-semibold tabular-nums">
                {f.home?.short_name ?? f.home?.name ?? 'TBC'} {scoreCellText(f, tickNow)} {f.away?.short_name ?? f.away?.name ?? 'TBC'}
              </span>
              {/* The heartbeat, and the only looping animation on the site.
                  It marks a match that is actually IN_PLAY — `state.live` is
                  false at half-time, because nothing is happening on the
                  pitch and so nothing should be pulsing. */}
              {state?.live && (
                <span className="inline-flex items-center gap-1 text-11 font-semibold uppercase tracking-wide text-live">
                  <span className="tl-live-dot size-1.5 rounded-full bg-live" aria-hidden="true" />
                  {state.text}
                </span>
              )}
            </li>
          );
        })}

        {fixtures.length === 0 && pending.map(({ league, kickoffUtc }) => {
          const comp = getCompetitionMeta(league.fd_code);
          const parts = precisePartsOf(kickoffUtc, tickNow);
          return (
            <li key={league.id} className="flex shrink-0 items-center gap-2 text-13">
              <span className={`size-1.5 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
              <span className="font-semibold">{league.name}</span>
              {/* `tabular-nums` plus the zero-padded clock from
                  `formatPreciseCountdown` is what stops the row twitching
                  sideways as digits change every second. "Under way" is the
                  same honest fallback `<Countdown>` uses once a target has
                  passed — never a blank slot, never a guessed score. */}
              <span className="font-mono text-13 font-bold tabular-nums">
                {parts === null
                  ? 'Under way'
                  : calm
                    ? `${parts.days > 0 ? `${parts.days}d ` : ''}${parts.hours}h`
                    : formatPreciseCountdown(parts)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
