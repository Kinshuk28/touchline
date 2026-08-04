import { countdownParts } from '@/lib/site/countdown';

/**
 * Server-rendered from a fixed `now` so there is no hydration mismatch; it
 * does not tick, which is correct for a multi-day countdown.
 *
 * Once the target has passed this renders an explicit "Under way" instead of
 * nothing (Finding 4): under ISR (`revalidate = 300`), a low-traffic route
 * can serve a page whose `now` is well behind real time, so the baked-in
 * countdown can sit past its target between regenerations. A blank slot next
 * to the league name reads as a bug; "Under way" is honest about not
 * knowing the live state without guessing a score.
 */
export function Countdown({ targetIso, now }: { targetIso: string; now: Date }) {
  const parts = countdownParts(targetIso, now);
  if (parts === null) {
    return <span className="font-mono text-13 font-bold text-muted">Under way</span>;
  }
  const { days, hours } = parts;
  return (
    // `font-mono` — the redesign spec's "every time, score and position uses
    // font-mono" applies to a countdown too; this previously rendered in the
    // body face despite being pure data.
    <span className="font-mono text-13 font-bold tabular-nums">
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`}
    </span>
  );
}
