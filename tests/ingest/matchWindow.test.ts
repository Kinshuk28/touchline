import { describe, it, expect } from 'vitest';
import { isMatchWindowOpen } from '@/lib/ingest/matchWindow';

const at = (iso: string) => new Date(iso);

describe('isMatchWindowOpen', () => {
  it('is closed when there are no fixtures at all', () => {
    expect(isMatchWindowOpen([], at('2026-08-03T12:00:00Z'))).toBe(false);
  });

  it('is closed during preseason, days before the first kickoff', () => {
    const f = [{ status: 'SCHEDULED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-03T12:00:00Z'))).toBe(false);
  });

  it('opens 15 minutes before kickoff', () => {
    const f = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T13:44:00Z'))).toBe(false);
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('is open whenever any fixture reports IN_PLAY, regardless of clock', () => {
    const f = [{ status: 'IN_PLAY' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T20:00:00Z'))).toBe(true);
  });

  it('stays open at half-time (PAUSED)', () => {
    const f = [{ status: 'PAUSED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:50:00Z'))).toBe(true);
  });

  it('closes 150 minutes after the last kickoff', () => {
    const f = [{ status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T16:29:00Z'))).toBe(true);
    expect(isMatchWindowOpen(f, at('2026-08-21T16:31:00Z'))).toBe(false);
  });

  it('spans a full matchday from the earliest to the latest kickoff', () => {
    const f = [
      { status: 'FINISHED' as const, kickoffUtc: '2026-08-22T11:30:00Z' },
      { status: 'TIMED' as const, kickoffUtc: '2026-08-22T19:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-22T15:00:00Z'))).toBe(true);
    expect(isMatchWindowOpen(f, at('2026-08-22T22:00:00Z'))).toBe(false);
  });

  it('ignores postponed and cancelled fixtures when deciding to open', () => {
    const f = [
      { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });
});
