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
