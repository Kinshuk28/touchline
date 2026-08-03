import { describe, it, expect } from 'vitest';
import { RateLimiter } from '@/lib/ingest/rateLimiter';

function harness(capacity = 10, windowMs = 60_000) {
  let clock = 0;
  const waits: number[] = [];
  const limiter = new RateLimiter({
    capacity,
    windowMs,
    now: () => clock,
    sleep: async (ms: number) => { waits.push(ms); clock += ms; },
  });
  return { limiter, waits, advance: (ms: number) => { clock += ms; } };
}

describe('RateLimiter', () => {
  it('allows exactly capacity requests without waiting', async () => {
    const { limiter, waits } = harness();
    for (let i = 0; i < 10; i++) await limiter.acquire();
    expect(waits).toEqual([]);
    expect(limiter.available).toBe(0);
  });

  it('sleeps when the bucket is empty', async () => {
    const { limiter, waits } = harness();
    for (let i = 0; i < 10; i++) await limiter.acquire();
    await limiter.acquire();
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(0);
  });

  it('refills after the window elapses', async () => {
    const { limiter, advance } = harness();
    for (let i = 0; i < 10; i++) await limiter.acquire();
    advance(60_000);
    expect(limiter.available).toBe(10);
  });

  it('self-corrects downward from the live response header', async () => {
    const { limiter } = harness();
    await limiter.acquire();
    expect(limiter.available).toBe(9);
    limiter.syncFromHeaders(new Headers({ 'x-requests-available-minute': '2' }));
    expect(limiter.available).toBe(2);
  });

  it('ignores a header that is absent or unparseable', async () => {
    const { limiter } = harness();
    await limiter.acquire();
    limiter.syncFromHeaders(new Headers({}));
    expect(limiter.available).toBe(9);
    limiter.syncFromHeaders(new Headers({ 'x-requests-available-minute': 'nonsense' }));
    expect(limiter.available).toBe(9);
  });
});
