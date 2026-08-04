const DAY_MS = 86_400_000;

function utc(iso: string): Date { return new Date(iso); }

/** Times are rendered in UTC so server and client agree and hydration is stable. */
function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatKickoff(iso: string, now: Date): string {
  const d = utc(iso);
  const sameDay = d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) return hhmm(d);
  const delta = d.getTime() - now.getTime();
  if (delta > 0 && delta < 7 * DAY_MS) return `${DAYS[d.getUTCDay()]} ${hhmm(d)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Null in, null out — a missing timestamp is never guessed at. */
export function relativeTime(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const diff = now.getTime() - utc(iso).getTime();
  if (Number.isNaN(diff)) return null;
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
