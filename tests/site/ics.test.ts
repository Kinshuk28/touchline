import { describe, it, expect } from 'vitest';
import { buildIcs } from '@/lib/site/ics';
import type { FixtureWithTeams } from '@/lib/site/rows';

const f: FixtureWithTeams = {
  id: 7, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T19:00:00Z',
  status: 'SCHEDULED', matchday: 1, home_goals: null, away_goals: null,
  updated_at: '2026-08-04T00:00:00Z',
  home: { id: 1, slug: 'rm', name: 'Real Madrid CF', short_name: 'Real Madrid', tla: 'RMA', crest_url: null },
  away: { id: 2, slug: 'fcb', name: 'FC Barcelona', short_name: 'Barça', tla: 'FCB', crest_url: null },
};

describe('buildIcs', () => {
  const ics = buildIcs([f], () => 'La Liga');

  it('is a well-formed calendar', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('names the fixture and its competition', () => {
    expect(ics).toContain('SUMMARY:Real Madrid CF v FC Barcelona');
    expect(ics).toContain('La Liga');
  });

  it('writes UTC timestamps in iCalendar basic format', () => {
    expect(ics).toContain('DTSTART:20260816T190000Z');
  });

  it('gives every event a stable UID derived from the fixture id', () => {
    expect(ics).toContain('UID:fixture-7@touchline');
  });

  it('assumes a two-hour duration so calendars block sensible time', () => {
    expect(ics).toContain('DTEND:20260816T210000Z');
  });

  it('uses CRLF line endings, which the spec requires', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('escapes commas in club names rather than breaking the field', () => {
    const odd = { ...f, home: { ...f.home!, name: 'Club A, B' } };
    expect(buildIcs([odd], () => 'X')).toContain('Club A\\, B');
  });
});

// Important 4: getFixturesInRange (the only query behind /calendar and this
// route) applies no status filter, and a postponed/cancelled/suspended
// fixture keeps its original kickoff_utc — so without this exclusion, a
// match that will never be played at that time creates a real VEVENT in
// every subscriber's calendar.
describe('buildIcs excludes non-playable fixtures (Important 4)', () => {
  it('drops a POSTPONED fixture entirely — no VEVENT for a match that will not happen at its old kickoff', () => {
    const postponed = { ...f, status: 'POSTPONED' as const };
    const ics = buildIcs([postponed], () => 'La Liga');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).not.toContain('fixture-7@touchline');
  });

  it('drops CANCELLED and SUSPENDED fixtures too', () => {
    const cancelled = { ...f, id: 8, status: 'CANCELLED' as const };
    const suspended = { ...f, id: 9, status: 'SUSPENDED' as const };
    const ics = buildIcs([cancelled, suspended], () => 'La Liga');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('keeps a playable fixture in the same batch as a postponed one', () => {
    const postponed = { ...f, id: 8, status: 'POSTPONED' as const };
    const ics = buildIcs([f, postponed], () => 'La Liga');
    expect(ics).toContain('UID:fixture-7@touchline');
    expect(ics).not.toContain('UID:fixture-8@touchline');
    // Exactly one event, not two.
    expect(ics.split('BEGIN:VEVENT')).toHaveLength(2);
  });

  it('still produces a well-formed (empty) calendar when every fixture is non-playable', () => {
    const postponed = { ...f, status: 'POSTPONED' as const };
    const ics = buildIcs([postponed], () => 'La Liga');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

// RFC 5545 line folding (`fold()` in lib/site/ics.ts): content lines over 75
// octets must be split with CRLF + a single leading space, and readers strip
// that back out. A malformed fold is a silent-import-failure in real
// calendar clients — nothing throws, the event just never appears — so this
// is exactly the kind of defect that needs a direct regression test rather
// than relying on the "is a well-formed calendar" smoke test above, which
// never exercises a line anywhere near the 75-octet limit.
//
// `fold()` itself is not exported; every test here drives it indirectly
// through `buildIcs`'s SUMMARY field, which is the one place a real, long
// club name can push a content line over the limit.
describe('buildIcs line folding (RFC 5545)', () => {
  // Mirrors the unfolding algorithm real calendar clients use: a physical
  // line that starts with a single space is a continuation of the previous
  // logical line, not a property of its own. Deliberately independent of
  // `fold()`'s implementation — this just walks CRLF-joined physical lines.
  function unfoldLines(ics: string): string[] {
    const physical = ics.split('\r\n');
    const logical: string[] = [];
    for (const line of physical) {
      if (line.startsWith(' ') && logical.length > 0) {
        logical[logical.length - 1] += line.slice(1);
      } else if (line.length > 0) {
        logical.push(line);
      }
    }
    return logical;
  }

  it('folds a long SUMMARY so every physical line is <=75 octets, each continuation starting with exactly one space', () => {
    const home = 'A'.repeat(60);
    const away = 'B'.repeat(60);
    const odd = { ...f, home: { ...f.home!, name: home }, away: { ...f.away!, name: away } };
    const ics = buildIcs([odd], () => 'La Liga');

    const physical = ics.split('\r\n');
    // Sanity: this fixture must actually contain a line that needed folding,
    // otherwise the test below would pass vacuously.
    expect(physical.some((l) => l.startsWith(' '))).toBe(true);

    for (const line of physical) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      if (line.startsWith(' ')) {
        // Exactly one leading space: a second structural space would show up
        // as a double space here, since none of this fixture's content
        // (all-caps club names joined by " v ") contains a literal space at
        // a fold boundary.
        expect(line.startsWith('  ')).toBe(false);
      }
    }
  });

  it('round-trips: stripping the fold CRLF + single space recovers the original unfolded value exactly', () => {
    const home = 'A'.repeat(60);
    const away = 'B'.repeat(60);
    const odd = { ...f, home: { ...f.home!, name: home }, away: { ...f.away!, name: away } };
    const ics = buildIcs([odd], () => 'La Liga');

    const summaryLine = unfoldLines(ics).find((l) => l.startsWith('SUMMARY:'));
    expect(summaryLine).toBe(`SUMMARY:${home} v ${away}`);
  });

  it('never splits a multi-byte UTF-8 character even when it straddles the 75-octet cut', () => {
    // Constructed so the accented character's first byte lands exactly at
    // byte offset 74 (0-indexed): "SUMMARY:" is 8 octets, plus 66 ASCII
    // octets = 74. A naive cut at the 75-octet limit would land between the
    // two bytes of 'é' (0xC3 0xA9), splitting it. Verified below before
    // relying on it.
    const home = `${'X'.repeat(66)}é${'Y'.repeat(40)}`;
    const away = 'Barcelona';
    const value = `${home} v ${away}`;
    const rawLine = `SUMMARY:${value}`;
    const rawBytes = Buffer.from(rawLine, 'utf8');
    expect(rawBytes[74]).toBe(0xc3); // first byte of 'é'
    expect(rawBytes[75]! & 0xc0).toBe(0x80); // its continuation byte

    const odd = { ...f, home: { ...f.home!, name: home }, away: { ...f.away!, name: away } };
    const ics = buildIcs([odd], () => 'La Liga');
    const physical = ics.split('\r\n');

    for (const line of physical) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      // A byte-level split of a multi-byte sequence decodes to U+FFFD.
      expect(line).not.toContain('�');
    }

    const summaryLine = unfoldLines(ics).find((l) => l.startsWith('SUMMARY:'));
    expect(summaryLine).toBe(rawLine);
  });

  it('does not fold a line at exactly 75 octets', () => {
    const home = 'A'.repeat(32);
    const away = 'B'.repeat(32);
    const value = `${home} v ${away}`;
    expect(Buffer.byteLength(`SUMMARY:${value}`, 'utf8')).toBe(75);

    const odd = { ...f, home: { ...f.home!, name: home }, away: { ...f.away!, name: away } };
    const ics = buildIcs([odd], () => 'La Liga');

    // Present verbatim as one physical line — folding would have broken
    // this exact substring across a CRLF + space.
    expect(ics.split('\r\n')).toContain(`SUMMARY:${value}`);
  });

  it('folds a line at 76 octets, one over the limit', () => {
    const home = 'A'.repeat(32);
    const away = 'B'.repeat(33);
    const value = `${home} v ${away}`;
    expect(Buffer.byteLength(`SUMMARY:${value}`, 'utf8')).toBe(76);

    const odd = { ...f, home: { ...f.home!, name: home }, away: { ...f.away!, name: away } };
    const ics = buildIcs([odd], () => 'La Liga');

    // No longer present as a single physical line...
    expect(ics.split('\r\n')).not.toContain(`SUMMARY:${value}`);
    // ...but unfolding recovers it exactly, and every physical line stays in budget.
    expect(unfoldLines(ics).find((l) => l.startsWith('SUMMARY:'))).toBe(`SUMMARY:${value}`);
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });
});
