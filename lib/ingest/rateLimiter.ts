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
    if (this.tokens <= 0) {
      const waitMs = this.windowMs - (this.now() - this.windowStart) + 250;
      await this.sleep(Math.max(waitMs, 0));
      this.refillIfWindowElapsed();
      if (this.tokens <= 0) {
        this.tokens = this.capacity;
        this.windowStart = this.now();
      }
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
