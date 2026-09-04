/**
 * India Standard Time — UTC+5:30, fixed, no daylight saving. Every kickoff
 * time on this site is shown in IST, chosen deliberately over a real
 * `Intl`/browser-local conversion: a *fixed* offset can be applied on the
 * server and produce byte-identical output for every visitor regardless of
 * their own timezone, so it carries none of the hydration-mismatch risk a
 * true local-timezone conversion would (server and client would disagree
 * the instant a visitor's device reports a different zone than the
 * server). See lib/site/format.ts for where this is applied.
 */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/**
 * The UTC instant shifted by the IST offset. Read this Date's `getUTC*`
 * fields afterward and they give IST wall-clock values — hour, minute,
 * day-of-month, day-of-week, month all come out correct for IST without
 * ever calling a locale- or runtime-timezone-dependent API.
 */
export function toIST(d: Date): Date {
  return new Date(d.getTime() + IST_OFFSET_MS);
}
