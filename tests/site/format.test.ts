import { describe, it, expect } from 'vitest';
import { formatKickoff, relativeTime, dataAge } from '@/lib/site/format';

const now = new Date('2026-08-16T12:00:00Z');

describe('formatKickoff', () => {
  it('shows only a time for a fixture later today', () => {
    expect(formatKickoff('2026-08-16T19:00:00Z', now)).toBe('19:00');
  });
  it('shows a weekday and time within the coming week', () => {
    expect(formatKickoff('2026-08-18T19:00:00Z', now)).toBe('Tue 19:00');
  });
  it('shows a date for anything further out', () => {
    expect(formatKickoff('2026-10-01T19:00:00Z', now)).toBe('1 Oct');
  });
});

describe('relativeTime', () => {
  it('returns null for a null timestamp rather than inventing one', () => {
    expect(relativeTime(null, now)).toBeNull();
  });
  it('reports minutes for something recent', () => {
    expect(relativeTime('2026-08-16T11:38:00Z', now)).toBe('22 min ago');
  });
  it('reports hours past an hour', () => {
    expect(relativeTime('2026-08-16T09:00:00Z', now)).toBe('3 hours ago');
  });
  it('uses a singular hour at exactly one', () => {
    expect(relativeTime('2026-08-16T11:00:00Z', now)).toBe('1 hour ago');
  });
  it('reports days past a day', () => {
    expect(relativeTime('2026-08-14T12:00:00Z', now)).toBe('2 days ago');
  });
  it('returns null for a future timestamp five minutes ahead', () => {
    expect(relativeTime('2026-08-16T12:05:00Z', now)).toBeNull();
  });
  it('returns null for a future timestamp two days ahead', () => {
    expect(relativeTime('2026-08-18T12:00:00Z', now)).toBeNull();
  });
  it('returns just now for exactly now', () => {
    expect(relativeTime('2026-08-16T12:00:00Z', now)).toBe('just now');
  });
});

describe('dataAge', () => {
  it('says just now for something within the minute', () => {
    expect(dataAge('2026-08-16T11:59:40Z', now)).toBe('just now');
  });
  it('otherwise reads as an update stamp', () => {
    expect(dataAge('2026-08-16T11:30:00Z', now)).toBe('updated 30 min ago');
  });
  it('returns update time unknown for a future timestamp', () => {
    expect(dataAge('2026-08-16T12:05:00Z', now)).toBe('update time unknown');
  });
});
