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
