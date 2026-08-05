export interface CountdownParts {
  days: number;
  hours: number;
}

/**
 * The day/hour arithmetic behind <Countdown>, extracted so it is
 * unit-testable without rendering a component. Returns `null` once the
 * target has arrived or passed — including the exact instant `now` reaches
 * it — because a countdown has nothing honest left to count down.
 */
export function countdownParts(targetIso: string, now: Date): CountdownParts | null {
  const ms = new Date(targetIso).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return { days, hours };
}

export interface PreciseCountdownParts extends CountdownParts {
  minutes: number;
  seconds: number;
}

/**
 * The same arithmetic to second resolution, for the landing ticker's
 * once-a-second countdown (components/Ticker.tsx). Kept separate from
 * `countdownParts` rather than widening it: every other caller renders from
 * a server-fixed `now` where minutes and seconds would be stale the instant
 * they were painted, and the day/hour shape is what they want. Same null
 * contract — nothing honest left to count down once the target arrives.
 */
export function precisePartsOf(targetIso: string, now: Date): PreciseCountdownParts | null {
  const base = countdownParts(targetIso, now);
  if (base === null) return null;
  const ms = new Date(targetIso).getTime() - now.getTime();
  return {
    ...base,
    minutes: Math.floor((ms % 3_600_000) / 60_000),
    seconds: Math.floor((ms % 60_000) / 1000),
  };
}

/**
 * The ticker's countdown string: `12d 06:14:07` beyond a day out, `06:14:07`
 * inside it. Two-digit, zero-padded and monospaced so the digits do not
 * shuffle sideways as they tick — the whole point of a ticking countdown is
 * that the eye can rest on it.
 */
export function formatPreciseCountdown(parts: PreciseCountdownParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}`;
  return parts.days > 0 ? `${parts.days}d ${clock}` : clock;
}
