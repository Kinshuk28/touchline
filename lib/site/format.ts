import { toIST } from '@/lib/site/timezone';

const DAY_MS = 86_400_000;

function ist(iso: string): Date { return toIST(new Date(iso)); }

/** Times are rendered in IST (see lib/site/timezone.ts): reading the shifted
 * instant's UTC fields gives IST wall-clock values while keeping server and
 * client output identical, so hydration never disagrees. */
function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatKickoff(iso: string, now: Date): string {
  const d = ist(iso);
  const nowD = toIST(now);
  const sameDay = d.toISOString().slice(0, 10) === nowD.toISOString().slice(0, 10);
  if (sameDay) return hhmm(d);
  const delta = new Date(iso).getTime() - now.getTime();
  if (delta > 0 && delta < 7 * DAY_MS) return `${DAYS[d.getUTCDay()]} ${hhmm(d)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Same day-window rule as `formatKickoff`, but the time is never dropped.
 * `formatKickoff`'s far (>7-days-out) branch returns a bare date ("16 Aug")
 * — fine once a fixture is close enough to fall into the same-day or
 * within-the-week branches above it, but the *only* branch that ever
 * mattered for a fixture more than a week out was the one with no time at
 * all. Before the season starts (every fixture in the database sits weeks
 * out), that made every kickoff time on `/calendar`, the landing page's
 * "Next fixtures" tiles, and `/scores`'s upcoming rows (via
 * `scoreDisplay.ts#scoreCellText`) simply vanish — not wrong, just absent.
 *
 * `dateContext`: pass `true` when the caller already states the fixture's
 * date some other way (e.g. `/calendar`'s day-grouping heading) — the
 * far-out branch then stays at weekday+time ("Tue 19:00") instead of
 * spelling the date out again ("16 Aug 19:00"), which would just repeat
 * what the heading above it already says. Default `false` for the two
 * ungrouped call sites (the landing page's fixture tiles, `/scores`'s
 * upcoming rows), where the date is the only clue a reader has.
 */
export function formatKickoffTime(iso: string, now: Date, opts: { dateContext?: boolean } = {}): string {
  const d = ist(iso);
  const nowD = toIST(now);
  const sameDay = d.toISOString().slice(0, 10) === nowD.toISOString().slice(0, 10);
  if (sameDay) return hhmm(d);
  if (opts.dateContext) return `${DAYS[d.getUTCDay()]} ${hhmm(d)}`;
  const delta = new Date(iso).getTime() - now.getTime();
  if (delta > 0 && delta < 7 * DAY_MS) return `${DAYS[d.getUTCDay()]} ${hhmm(d)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hhmm(d)}`;
}

/** Null in, null out — a missing timestamp is never guessed at. */
export function relativeTime(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const diff = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function dataAge(updatedAt: string, now: Date): string {
  const rel = relativeTime(updatedAt, now);
  if (rel === null) return 'update time unknown';
  return rel === 'just now' ? 'just now' : `updated ${rel}`;
}

/**
 * Freshness of the *poll*, not of the data — "checked 2 min ago" rather
 * than "updated 2 min ago". `LiveScores` used to derive its freshness stamp
 * from the newest row's `updated_at`, which only advances when a score or
 * status actually changes; a no-op poll (by far the common case) now skips
 * `setState` entirely, so during a goalless spell the stamp froze at the
 * last real change instead of reflecting that the panel is still polling.
 * `lastPolledAt` is set on every *successful* fetch regardless of whether
 * anything changed, so this always answers "is this panel still alive",
 * which `dataAge` cannot.
 */
export function checkedAge(lastPolledAt: string, now: Date): string {
  const rel = relativeTime(lastPolledAt, now);
  if (rel === null) return 'check time unknown';
  return rel === 'just now' ? 'checked just now' : `checked ${rel}`;
}
