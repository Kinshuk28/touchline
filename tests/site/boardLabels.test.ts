import { describe, it, expect } from 'vitest';
import { fixtureDateRange, fixturePanelHeading } from '@/lib/site/boardLabels';

describe('fixturePanelHeading', () => {
  // A Wednesday, matching the real preseason state this ships in.
  const wed = new Date('2026-08-05T09:00:00Z');

  it('claims nothing when there are no fixtures', () => {
    expect(fixturePanelHeading(null, wed)).toBe('Fixtures');
  });

  it('says Today for a fixture later the same day', () => {
    expect(fixturePanelHeading('2026-08-05', wed)).toBe('Today');
  });

  it('says Today for a day already begun, never a negative countdown', () => {
    expect(fixturePanelHeading('2026-08-04', wed)).toBe('Today');
  });

  it.each([
    ['2026-08-07', 'Friday'],
    ['2026-08-08', 'Saturday'],
    ['2026-08-09', 'Sunday'],
  ])('says This weekend for %s (%s), the coming weekend', (day) => {
    expect(fixturePanelHeading(day, wed)).toBe('This weekend');
  });

  it('says This weekend from Monday onwards, not only once it has started', () => {
    const mon = new Date('2026-08-10T09:00:00Z');
    expect(fixturePanelHeading('2026-08-15', mon)).toBe('This weekend'); // Saturday, 5 days out
  });

  it('says Next up for a midweek fixture', () => {
    expect(fixturePanelHeading('2026-08-06', wed)).toBe('Next up'); // Thursday
  });

  it('says Next up for the real preseason case rather than pretending it is this weekend', () => {
    // Season opens Sunday 2026-08-16 — a Sunday, but eleven days away.
    expect(fixturePanelHeading('2026-08-16', wed)).toBe('Next up');
  });
});

describe('fixtureDateRange', () => {
  it('returns null for no days', () => {
    expect(fixtureDateRange([])).toBeNull();
  });

  it('states a single day in full', () => {
    expect(fixtureDateRange([{ date: '2026-08-16' }])).toBe('Sun 16 Aug');
  });

  it('prints the month once when both ends share it', () => {
    expect(fixtureDateRange([{ date: '2026-08-15' }, { date: '2026-08-17' }])).toBe('Sat 15 — Mon 17 Aug');
  });

  it('prints both months when the range crosses one', () => {
    expect(fixtureDateRange([{ date: '2026-08-30' }, { date: '2026-09-01' }])).toBe('Sun 30 Aug — Tue 1 Sep');
  });
});
