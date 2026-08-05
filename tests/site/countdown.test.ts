import { describe, it, expect } from 'vitest';
import { countdownParts, formatPreciseCountdown, precisePartsOf } from '@/lib/site/countdown';
import { Countdown } from '@/components/Countdown';

describe('countdownParts', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('renders days and hours for a target several days out', () => {
    expect(countdownParts('2026-08-16T18:30:00Z', now)).toEqual({ days: 12, hours: 6 });
  });

  it('renders hours only for a target under one day out', () => {
    expect(countdownParts('2026-08-04T20:00:00Z', now)).toEqual({ days: 0, hours: 8 });
  });

  it('returns null for a target in the past', () => {
    expect(countdownParts('2026-08-01T00:00:00Z', now)).toBeNull();
  });

  it('returns null for a target exactly at now — nothing left to count down', () => {
    expect(countdownParts('2026-08-04T12:00:00Z', now)).toBeNull();
  });
});

// Finding 4: <Countdown> must never render blank when the target has passed
// (e.g. ISR staleness leaving a page's baked-in `now` behind real time, or a
// countdown target sitting exactly at `now`). It renders an explicit "Under
// way" instead of returning null, so a league row never shows a name with
// nothing beside it. Countdown is a plain, hookless function component, so
// it can be invoked directly and its returned element inspected without a
// DOM or a rendering library.
describe('Countdown (expired-target rendering — Finding 4)', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('renders an explicit "Under way" for a target that has already passed', () => {
    const el = Countdown({ targetIso: '2026-08-01T00:00:00Z', now });
    expect(el).not.toBeNull();
    expect(el.props.children).toBe('Under way');
  });

  it('renders "Under way" for a target exactly at now, not a blank countdown', () => {
    const el = Countdown({ targetIso: '2026-08-04T12:00:00Z', now });
    expect(el.props.children).toBe('Under way');
  });

  it('renders the day/hour text for a future target', () => {
    const el = Countdown({ targetIso: '2026-08-16T18:30:00Z', now });
    expect(el.props.children).toBe('12d 6h');
  });
});

describe('precisePartsOf / formatPreciseCountdown', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('breaks a multi-day target down to seconds', () => {
    expect(precisePartsOf('2026-08-16T18:30:45Z', now)).toEqual({
      days: 12, hours: 6, minutes: 30, seconds: 45,
    });
  });

  it('keeps the same null contract as countdownParts', () => {
    expect(precisePartsOf('2026-08-04T12:00:00Z', now)).toBeNull();
    expect(precisePartsOf('2026-08-01T00:00:00Z', now)).toBeNull();
  });

  it('zero-pads the clock so ticking digits never shift sideways', () => {
    expect(formatPreciseCountdown({ days: 12, hours: 6, minutes: 4, seconds: 7 })).toBe('12d 06:04:07');
  });

  it('drops the day segment inside the last day', () => {
    expect(formatPreciseCountdown({ days: 0, hours: 6, minutes: 4, seconds: 7 })).toBe('06:04:07');
  });
});
