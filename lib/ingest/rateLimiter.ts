export interface RateLimiterOptions {
  capacity: number;
  windowMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private tokens: number;
  private windowStart: number;
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.tokens = opts.capacity;
    this.windowStart = this.now();
  }

  private refillIfWindowElapsed(): void {
    const elapsed = this.now() - this.windowStart;
    if (elapsed < 0) {
      // Non-monotonic clock (e.g. an NTP correction) moved `now()` backwards.
      // Re-anchor the window to the current time so future waits are
      // computed correctly, but never treat this as capacity earned —
      // tokens are left untouched.
      this.windowStart = this.now();
      return;
    }
    if (elapsed >= this.windowMs) {
      this.tokens = this.capacity;
      this.windowStart = this.now();
    }
  }

  get available(): number {
    this.refillIfWindowElapsed();
    return this.tokens;
  }

  async acquire(): Promise<void> {
    this.refillIfWindowElapsed();
    // Loop rather than sleep-once-and-fall-back: `now()` is `Date.now()` by
    // default, which is NOT monotonic. A clock correction between the
    // pre-sleep and post-sleep reads can make `elapsed` small or negative
    // even though real time genuinely passed during the sleep. If we still
    // haven't seen a full window elapse, the only correct move is to wait
    // again — never to force-grant a token that wasn't actually earned.
    while (this.tokens <= 0) {
      const waitMs = this.windowMs - (this.now() - this.windowStart) + 250;
      await this.sleep(Math.max(waitMs, 0));
      this.refillIfWindowElapsed();
    }
    this.tokens -= 1;
  }

  /**
   * The provider is the source of truth. If it reports fewer remaining
   * requests than we think we have, trust it — retries and parallel runs
   * make a purely local count drift optimistic.
   */
  syncFromHeaders(headers: Headers): void {
    const raw = headers.get('x-requests-available-minute');
    if (raw === null) return;
    const reported = Number.parseInt(raw, 10);
    if (Number.isNaN(reported)) return;
    this.tokens = Math.min(this.tokens, Math.max(reported, 0));
  }
}
