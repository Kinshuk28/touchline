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

  it('a sleep that under-advances the clock does not over-grant', async () => {
    // sleep only advances the injected clock by a fraction of the requested
    // duration, simulating a non-monotonic Date.now() that jumps backwards
    // between the pre-sleep and post-sleep reads.
    let clock = 0;
    const waits: number[] = [];
    const availableSamples: number[] = [];
    const capacity = 10;
    const limiter = new RateLimiter({
      capacity,
      windowMs: 60_000,
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms / 10; // under-advance: only 10% of the requested wait
      },
    });

    for (let i = 0; i < capacity; i++) {
      await limiter.acquire();
      availableSamples.push(limiter.available);
    }

    await limiter.acquire();
    availableSamples.push(limiter.available);

    expect(waits.length).toBeGreaterThan(1);
    for (const sample of availableSamples) {
      expect(sample).toBeLessThanOrEqual(capacity);
    }
  });

  it('a backwards clock jump grants no free tokens', async () => {
    // The first sleep simulates an NTP correction: wall-clock time genuinely
    // passes, but the injected clock jumps backwards instead of forward, so
    // the post-sleep read is earlier than the pre-sleep read. A correct
    // limiter must not mistake that for an elapsed window; it must keep
    // waiting (a second, real sleep) rather than force-granting a token.
    const capacity = 10;
    let clock = 0;
    let sleepCalls = 0;
    const limiter = new RateLimiter({
      capacity,
      windowMs: 60_000,
      now: () => clock,
      sleep: async (ms: number) => {
        sleepCalls += 1;
        if (sleepCalls === 1) {
          clock -= 30_000; // backwards jump — no real elapsed time recorded
        } else {
          clock += ms; // subsequent sleeps behave normally
        }
      },
    });

    for (let i = 0; i < capacity; i++) await limiter.acquire();
    expect(limiter.available).toBe(0);

    await limiter.acquire();

    // A single backwards-jumping sleep must not have been enough to unlock
    // the 11th request — the limiter had to sleep again for real.
    expect(sleepCalls).toBeGreaterThan(1);
    // And the token it eventually granted came from a genuine refill, not a
    // free capacity-reset: available should now reflect one token consumed
    // out of a legitimately refilled bucket, never more than capacity.
    expect(limiter.available).toBeLessThanOrEqual(capacity - 1);
  });

  it('refills exactly once to capacity after a genuine full window', async () => {
    const { limiter, advance } = harness();
    for (let i = 0; i < 10; i++) await limiter.acquire();
    advance(60_000);
    expect(limiter.available).toBe(10);
    advance(1_000);
    expect(limiter.available).toBe(10);
  });
});
