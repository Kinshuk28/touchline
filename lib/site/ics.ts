import type { FixtureWithTeams } from '@/lib/site/rows';

const MATCH_MINUTES = 120;

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Commas, semicolons and newlines are field separators in iCalendar. */
function esc(text: string): string {
  return text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

/**
 * RFC 5545 requires content lines to be folded at 75 octets: a line that
 * would exceed that is split with a CRLF followed by a single leading
 * space, which readers must strip back out. Club names with long official
 * titles (plus a two-line SUMMARY/DESCRIPTION prefix) can cross this limit,
 * and an unfolded line is exactly the kind of "silently fails to import"
 * defect that is invisible until a real calendar client chokes on it.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte UTF-8 sequence: back off while the next
    // byte is a continuation byte (top two bits `10`).
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines start with a folding space, so 74 bytes of content + 1 space = 75
  }
  return parts.join('\r\n ');
}

export function buildIcs(
  fixtures: FixtureWithTeams[],
  leagueName: (leagueId: number) => string,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Touchline//Fixtures//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Touchline fixtures',
  ];

  for (const f of fixtures) {
    const home = f.home?.name ?? 'TBC';
    const away = f.away?.name ?? 'TBC';
    const end = new Date(new Date(f.kickoff_utc).getTime() + MATCH_MINUTES * 60_000).toISOString();
    lines.push(
      'BEGIN:VEVENT',
      `UID:fixture-${f.id}@touchline`,
      // RFC 5545 defines DTSTAMP as creation time, which would normally mean
      // wall-clock "now". Deliberately using the DB row's `updated_at`
      // instead: the calendar.ics route is force-dynamic/no-store, so it
      // regenerates on every fetch, and a wall-clock DTSTAMP would change on
      // every single request even when nothing about the fixture changed —
      // worse for calendar clients doing change detection than a stamp that
      // only moves when the underlying data actually does.
      `DTSTAMP:${stamp(f.updated_at)}`,
      `DTSTART:${stamp(f.kickoff_utc)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${home} v ${away}`)}`,
      `DESCRIPTION:${esc(leagueName(f.league_id))}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
