# Touchline Phase A — Data Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled ingestion pipeline that keeps a Supabase Postgres database continuously populated with fixtures, results, standings, squads, player statistics and news for the top five European leagues — using only permanently-free data sources.

**Architecture:** Provider adapters behind narrow typed interfaces feed staleness-driven jobs, which write to Postgres through a repository layer. A token-bucket rate limiter that self-corrects from live response headers governs all football-data.org traffic. GitHub Actions cron invokes the jobs. Nothing in this phase renders UI.

**Tech Stack:** TypeScript, Node 24, Vitest, `@supabase/supabase-js`, `zod`, `rss-parser`, GitHub Actions.

## Global Constraints

- **No paid services, ever.** Every component must sit in a permanent free tier.
- **football-data.org rate limit: 10 requests/minute.** Confirmed from live headers (`x-requests-available-minute`, `X-RequestCounter-Reset: 60`). Every outbound call to it must pass through the rate limiter.
- **No live provider calls in tests or CI.** All adapter tests run against committed JSON snapshots.
- **API-Football is dormant.** Its free plan serves only seasons 2022–2024. Do not build anything in this phase that depends on it.
- **Deep player statistics exist for the Premier League only** (FPL API). Other leagues get bio + top-scorer figures. **Never estimate, interpolate, or invent a statistic.** A missing value is `null` and is displayed as unavailable.
- **Jobs are staleness-driven, never clock-driven.** GitHub Actions cron fires late or skips; every job must ask "what is older than its freshness target?" and be safe to run twice.
- **League codes are exactly:** `PL` (Premier League), `PD` (La Liga), `SA` (Serie A), `BL1` (Bundesliga), `FL1` (Ligue 1).
- **Current season is `2026`** (football-data.org uses the starting year). Previous season for backfill is `2025`.
- All secrets come from `.env.local` locally and GitHub repository secrets in CI. Never commit a key.

---

## File Structure

```
lib/
  config/env.ts                 Typed, validated environment access
  db/client.ts                  Supabase service-role client factory
  db/repositories/
    leagues.ts                  upsertLeagues, getLeagues
    teams.ts                    upsertTeams, getTeamIdByFdId
    players.ts                  upsertPlayers
    fixtures.ts                 upsertFixtures, getWindowFixtures
    standings.ts                upsertStandings
    playerStats.ts              upsertPlayerSeasonStats
    news.ts                     upsertNewsItems
    runs.ts                     startRun, finishRun
  providers/
    types.ts                    Shared domain types (Fixture, Standing, ...)
    footballData.ts             football-data.org adapter
    fpl.ts                      Fantasy Premier League adapter
    rss.ts                      RSS adapter + classification
  ingest/
    rateLimiter.ts              Token bucket with header self-correction
    matchWindow.ts              "is anything in play right now?"
scripts/
  ingest/core.ts                Standings, fixtures, results, scorers
  ingest/players.ts             FPL stats + squad refresh
  ingest/news.ts                RSS
  ingest/live.ts                In-play refresh, guarded
  backfill.ts                   One-time: leagues, teams, squads, 2025-26 history
  verify-schema.ts              Asserts every table exists
supabase/migrations/
  0001_init.sql                 Full schema
tests/
  fixtures/*.json               Recorded provider responses
  **/*.test.ts
.github/workflows/
  ingest-*.yml, keepalive.yml, ci.yml
```

---

### Task 1: Project scaffold and typed environment config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `lib/config/env.ts`
- Test: `tests/config/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadEnv(source?: Record<string,string|undefined>): Env` where
  `Env = { FOOTBALL_DATA_KEY: string; SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }`.
  Throws `Error` with a readable message listing every invalid field.

- [ ] **Step 1: Initialise the project**

```bash
cd /Users/kinshukkhandelwal/Desktop/Claude/football-app
npm init -y
npm pkg set type="module"
npm i zod @supabase/supabase-js rss-parser
npm i -D typescript vitest @types/node tsx dotenv
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["lib/**/*", "scripts/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

```bash
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.typecheck="tsc --noEmit"
```

- [ ] **Step 5: Write the failing test**

Create `tests/config/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '@/lib/config/env';

const valid = {
  FOOTBALL_DATA_KEY: 'a'.repeat(32),
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'b'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 'c'.repeat(40),
};

describe('loadEnv', () => {
  it('returns a typed env object when everything is present', () => {
    expect(loadEnv(valid).SUPABASE_URL).toBe(valid.SUPABASE_URL);
  });

  it('throws naming the missing variable', () => {
    const { FOOTBALL_DATA_KEY, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/FOOTBALL_DATA_KEY/);
  });

  it('rejects the Supabase dashboard URL, which is the common mistake', () => {
    expect(() =>
      loadEnv({ ...valid, SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst' }),
    ).toThrow(/API URL/);
  });

  it('rejects a trailing slash so request paths never double up', () => {
    expect(() =>
      loadEnv({ ...valid, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/' }),
    ).toThrow(/trailing slash/);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm test -- tests/config/env.test.ts`
Expected: FAIL — `Cannot find module '@/lib/config/env'`

- [ ] **Step 7: Implement `lib/config/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  FOOTBALL_DATA_KEY: z.string().min(10, 'FOOTBALL_DATA_KEY looks too short'),
  SUPABASE_URL: z
    .string()
    .url()
    .refine((u) => !u.endsWith('/'), 'SUPABASE_URL must not have a trailing slash')
    .refine(
      (u) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u),
      'SUPABASE_URL must be the project API URL (https://<ref>.supabase.co), not the dashboard URL',
    ),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- tests/config/env.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts lib/config/env.ts tests/config/env.test.ts
git commit -m "feat: project scaffold and validated environment config"
```

---

### Task 2: Database schema

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/migrations/0002_grants_and_rls.sql`
- Create: `lib/db/client.ts`
- Create: `scripts/verify-schema.ts`

**Interfaces:**
- Consumes: `loadEnv` from Task 1.
- Produces: `serviceClient(): SupabaseClient` — a Supabase client authenticated with the service role key, for use by all ingestion code.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0001_init.sql`:

```sql
create extension if not exists pg_trgm;

create table leagues (
  id            bigserial primary key,
  fd_code       text unique not null,
  fd_id         integer unique not null,
  slug          text unique not null,
  name          text not null,
  country       text not null,
  emblem_url    text,
  current_season integer not null,
  season_start  date,
  season_end    date,
  updated_at    timestamptz not null default now()
);

create table teams (
  id          bigserial primary key,
  fd_id       integer unique not null,
  league_id   bigint references leagues(id) on delete cascade,
  slug        text unique not null,
  name        text not null,
  short_name  text,
  tla         text,
  crest_url   text,
  venue       text,
  founded     integer,
  club_colors text,
  updated_at  timestamptz not null default now()
);

create table players (
  id            bigserial primary key,
  fd_id         integer unique,
  fpl_id        integer unique,
  team_id       bigint references teams(id) on delete set null,
  slug          text unique not null,
  name          text not null,
  position      text,
  nationality   text,
  date_of_birth date,
  photo_url     text,
  updated_at    timestamptz not null default now()
);

create table fixtures (
  id              bigserial primary key,
  fd_id           integer unique not null,
  league_id       bigint not null references leagues(id) on delete cascade,
  home_team_id    bigint references teams(id) on delete set null,
  away_team_id    bigint references teams(id) on delete set null,
  season          integer not null,
  kickoff_utc     timestamptz not null,
  status          text not null,
  matchday        integer,
  home_goals      integer,
  away_goals      integer,
  half_time_home  integer,
  half_time_away  integer,
  last_updated    timestamptz,
  updated_at      timestamptz not null default now()
);

create table standings (
  league_id        bigint not null references leagues(id) on delete cascade,
  team_id          bigint not null references teams(id) on delete cascade,
  season           integer not null,
  position         integer not null,
  played           integer not null,
  won              integer not null,
  drawn            integer not null,
  lost             integer not null,
  goals_for        integer not null,
  goals_against    integer not null,
  goal_difference  integer not null,
  points           integer not null,
  form             text,
  updated_at       timestamptz not null default now(),
  primary key (league_id, season, team_id)
);

create table player_season_stats (
  player_id       bigint not null references players(id) on delete cascade,
  league_id       bigint not null references leagues(id) on delete cascade,
  season          integer not null,
  source          text not null,
  appearances     integer,
  minutes         integer,
  goals           integer,
  assists         integer,
  expected_goals  numeric(6,2),
  yellow_cards    integer,
  red_cards       integer,
  updated_at      timestamptz not null default now(),
  primary key (player_id, season, source)
);

create table news_items (
  id           bigserial primary key,
  source       text not null,
  title        text not null,
  summary      text,
  url          text not null,
  image_url    text,
  published_at timestamptz not null,
  league_id    bigint references leagues(id) on delete set null,
  team_ids     bigint[] not null default '{}',
  categories   text[] not null default '{}',
  content_hash text unique not null,
  created_at   timestamptz not null default now()
);

create table ingest_run (
  id            bigserial primary key,
  job           text not null,
  status        text not null,
  message       text,
  requests_used integer not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table ingest_budget (
  provider      text not null,
  day_utc       date not null,
  requests_used integer not null default 0,
  primary key (provider, day_utc)
);

create index fixtures_kickoff_idx    on fixtures (kickoff_utc);
create index fixtures_status_idx     on fixtures (status);
create index fixtures_league_season  on fixtures (league_id, season);
create index standings_lookup_idx    on standings (league_id, season, position);
create index news_published_idx      on news_items (published_at desc);
create index teams_name_trgm         on teams  using gin (name gin_trgm_ops);
create index players_name_trgm       on players using gin (name gin_trgm_ops);
```

- [ ] **Step 2: Apply it**

Open the Supabase dashboard → **SQL Editor** → **New query** → paste the entire contents of `supabase/migrations/0001_init.sql` → **Run**.
Expected: `Success. No rows returned`.

- [ ] **Step 3: Write and apply `supabase/migrations/0002_grants_and_rls.sql`**

Creating tables via the SQL Editor does **not** grant the PostgREST roles
(`anon`, `authenticated`, `service_role`) any privileges on them — Postgres
privileges are always explicit, and the SQL Editor's own session role owns
the new tables but nobody else does. Left unaddressed, every PostgREST
request against every table fails with `permission denied for table <name>`,
for every role, including `service_role` — confirmed empirically after
applying 0001.

Write `supabase/migrations/0002_grants_and_rls.sql` to:
- grant `service_role` full read/write on all nine tables (and their
  sequences), since ingestion jobs authenticate with it and it must be able
  to write;
- grant `anon` and `authenticated` **`select` only** — never insert/update/
  delete. This is deliberate, not an oversight: Phase B ships the `anon` key
  to the browser, so any write privilege granted to `anon` would let every
  site visitor mutate the database (fabricate fixtures, delete standings);
- enable Row Level Security on all nine tables with a read-only policy for
  `anon`/`authenticated`, as defence in depth so a future accidental grant
  still can't produce a write from the public key;
- set default privileges for the `public` schema so tables added by later
  migrations automatically inherit this same posture (full for
  `service_role`, select-only for `anon`/`authenticated`) without another
  manual grants migration.

Make every statement idempotent (safe to run twice) — `drop policy if
exists` before each `create policy`, and rely on `grant`/`alter default
privileges`/`enable row level security` being naturally idempotent in
Postgres.

Open the Supabase dashboard → **SQL Editor** → **New query** → paste the
entire contents of `supabase/migrations/0002_grants_and_rls.sql` → **Run**.
Expected: `Success. No rows returned`.

- [ ] **Step 4: Implement `lib/db/client.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '@/lib/config/env';

let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const env = loadEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 5: Implement `scripts/verify-schema.ts`**

```ts
import 'dotenv/config';
import { serviceClient } from '@/lib/db/client';

const TABLES = [
  'leagues', 'teams', 'players', 'fixtures', 'standings',
  'player_season_stats', 'news_items', 'ingest_run', 'ingest_budget',
];

const db = serviceClient();
let failed = false;

for (const table of TABLES) {
  const { error } = await db.from(table).select('*').limit(1);
  if (error) {
    console.error(`  MISSING  ${table}  (${error.message})`);
    failed = true;
  } else {
    console.log(`  ok       ${table}`);
  }
}

if (failed) {
  console.error('\nSchema incomplete. Re-run supabase/migrations/0001_init.sql in the SQL Editor.');
  process.exit(1);
}
console.log('\nAll tables present.');
```

- [ ] **Step 6: Run it**

```bash
npx tsx --env-file=.env.local scripts/verify-schema.ts
```

Expected: nine `ok` lines, then `All tables present.` (Requires Step 3's
grants to already be applied — without them `service_role` itself gets
`permission denied` on every table.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0001_init.sql supabase/migrations/0002_grants_and_rls.sql lib/db/client.ts scripts/verify-schema.ts
git commit -m "feat: database schema, service client and schema verification"
```

---

### Task 3: Rate limiter

**Files:**
- Create: `lib/ingest/rateLimiter.ts`
- Test: `tests/ingest/rateLimiter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class RateLimiter { constructor(opts: { capacity: number; windowMs: number; now?: () => number; sleep?: (ms:number)=>Promise<void> }); acquire(): Promise<void>; syncFromHeaders(h: Headers): void; get available(): number }`

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/rateLimiter.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/ingest/rateLimiter.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ingest/rateLimiter'`

- [ ] **Step 3: Implement `lib/ingest/rateLimiter.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/ingest/rateLimiter.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/rateLimiter.ts tests/ingest/rateLimiter.test.ts
git commit -m "feat: token-bucket rate limiter with header self-correction"
```

---

### Task 4: Domain types and football-data.org adapter

**Files:**
- Create: `lib/providers/types.ts`, `lib/providers/footballData.ts`
- Create: `tests/fixtures/fd-matches-pl.json`, `tests/fixtures/fd-standings-pl.json`, `tests/fixtures/fd-team-57.json`
- Create: `tests/fixtures/fd-matches-pl-2025.json`, `tests/fixtures/fd-scorers-pl-2025.json`
- Test: `tests/providers/footballData.test.ts`

**Interfaces:**
- Consumes: `RateLimiter` (Task 3).
- Produces:
  - Types: `LeagueCode`, `FixtureStatus`, `RawFixture`, `RawStanding`, `RawSquadMember`, `RawScorer`
  - `class FootballDataClient { constructor(opts: { apiKey: string; limiter: RateLimiter; fetchImpl?: typeof fetch }); getMatches(code: LeagueCode, season: number): Promise<RawFixture[]>; getStandings(code: LeagueCode, season: number): Promise<RawStanding[]>; getSquad(teamFdId: number): Promise<{ team: RawTeam; squad: RawSquadMember[] }>; getScorers(code: LeagueCode, season: number): Promise<RawScorer[]> }`

- [ ] **Step 1: Capture real response snapshots**

```bash
mkdir -p tests/fixtures
set -a && . ./.env.local && set +a
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/competitions/PL/matches?season=2026" \
  -o tests/fixtures/fd-matches-pl.json
sleep 7
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/competitions/PL/standings?season=2025" \
  -o tests/fixtures/fd-standings-pl.json
sleep 7
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/teams/57" \
  -o tests/fixtures/fd-team-57.json
sleep 7
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/competitions/PL/matches?season=2025" \
  -o tests/fixtures/fd-matches-pl-2025.json
sleep 7
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/competitions/PL/scorers?season=2025&limit=50" \
  -o tests/fixtures/fd-scorers-pl-2025.json
```

Verify each file is real JSON, not an error body:

```bash
node -e "for (const f of ['fd-matches-pl','fd-standings-pl','fd-team-57','fd-matches-pl-2025','fd-scorers-pl-2025']) { const j = require('./tests/fixtures/'+f+'.json'); console.log(f, Object.keys(j).slice(0,4).join(',')); }"
```

Expected: keys including `matches`, `standings`, `squad`, `matches`, `scorers` respectively.

**Why two more captures were needed:** `fd-matches-pl.json` is the 2026-27 season, captured before a ball was kicked (380 SCHEDULED, 0 FINISHED). It only proves the unplayed half of the null-vs-zero rule — that an unplayed match maps to `null` goals. The played half — a real match mapping to its actual goals, half-time score and `lastUpdated`, and specifically a genuine 0-0 FINISHED match mapping to `0` rather than `null` — was entirely untested. `fd-matches-pl-2025.json` (the complete, fully-played 2025-26 season: 380 FINISHED matches, 27 of them genuine 0-0 draws) closes that gap. Similarly, `getScorers` — the only free source of goals/assists for La Liga, Serie A, Bundesliga and Ligue 1 — had zero test coverage; `fd-scorers-pl-2025.json` (season=2025, since the 2026 season returns an empty scorers list) closes it. Both fixtures are committed alongside the code, same as the original three.

- [ ] **Step 2: Write `lib/providers/types.ts`**

```ts
export type LeagueCode = 'PL' | 'PD' | 'SA' | 'BL1' | 'FL1';

export const LEAGUE_CODES: LeagueCode[] = ['PL', 'PD', 'SA', 'BL1', 'FL1'];

/** football-data.org match statuses, verbatim. */
export type FixtureStatus =
  | 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED'
  | 'FINISHED' | 'POSTPONED' | 'SUSPENDED' | 'CANCELLED' | 'AWARDED';

export const IN_PLAY_STATUSES: FixtureStatus[] = ['IN_PLAY', 'PAUSED'];

export interface RawTeam {
  fdId: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crestUrl: string | null;
  venue: string | null;
  founded: number | null;
  clubColors: string | null;
}

export interface RawFixture {
  fdId: number;
  leagueCode: LeagueCode;
  season: number;
  kickoffUtc: string;
  status: FixtureStatus;
  matchday: number | null;
  homeTeamFdId: number;
  awayTeamFdId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  halfTimeHome: number | null;
  halfTimeAway: number | null;
  lastUpdated: string | null;
}

export interface RawStanding {
  teamFdId: number;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string | null;
}

export interface RawSquadMember {
  fdId: number;
  name: string;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
}

export interface RawScorer {
  playerFdId: number;
  playerName: string;
  teamFdId: number;
  goals: number | null;
  assists: number | null;
  playedMatches: number | null;
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/providers/footballData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FootballDataClient } from '@/lib/providers/footballData';
import { RateLimiter } from '@/lib/ingest/rateLimiter';

const snap = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, 'utf8'));

function clientFor(body: unknown, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers });
  }) as unknown as typeof fetch;
  const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, sleep: async () => {} });
  return { client: new FootballDataClient({ apiKey: 'k', limiter, fetchImpl }), calls, limiter };
}

describe('FootballDataClient.getMatches', () => {
  it('maps every match to a RawFixture', async () => {
    const { client } = clientFor(snap('fd-matches-pl'));
    const out = await client.getMatches('PL', 2026);
    expect(out.length).toBeGreaterThan(300);
    const f = out[0]!;
    expect(f.leagueCode).toBe('PL');
    expect(f.season).toBe(2026);
    expect(typeof f.fdId).toBe('number');
    expect(typeof f.homeTeamFdId).toBe('number');
    expect(f.kickoffUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('represents an unplayed match with null goals, never zero', async () => {
    const { client } = clientFor(snap('fd-matches-pl'));
    const out = await client.getMatches('PL', 2026);
    const scheduled = out.find((f) => f.status === 'SCHEDULED' || f.status === 'TIMED')!;
    expect(scheduled.homeGoals).toBeNull();
    expect(scheduled.awayGoals).toBeNull();
  });

  it('sends the auth header and the season parameter', async () => {
    const { client, calls } = clientFor(snap('fd-matches-pl'));
    await client.getMatches('PD', 2025);
    expect(calls[0]).toContain('/competitions/PD/matches');
    expect(calls[0]).toContain('season=2025');
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-matches-pl'), {
      'x-requests-available-minute': '3',
    });
    await client.getMatches('PL', 2026);
    expect(limiter.available).toBe(3);
  });
});

describe('FootballDataClient.getMatches — played matches (2025 season, all FINISHED)', () => {
  it('maps FINISHED matches to real numeric goals, and at least one has a non-zero score', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const finished = out.filter((f) => f.status === 'FINISHED');
    expect(finished.length).toBeGreaterThan(300);

    const nonZero = finished.find((f) => (f.homeGoals ?? 0) > 0 || (f.awayGoals ?? 0) > 0);
    expect(nonZero).toBeDefined();
    expect(typeof nonZero!.homeGoals).toBe('number');
    expect(typeof nonZero!.awayGoals).toBe('number');
  });

  it('maps half-time scores on a played match', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const withHalfTime = out.find((f) => f.status === 'FINISHED' && f.halfTimeHome !== null);
    expect(withHalfTime).toBeDefined();
    expect(typeof withHalfTime!.halfTimeHome).toBe('number');
    expect(typeof withHalfTime!.halfTimeAway).toBe('number');
  });

  it('populates lastUpdated on a played match', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const finished = out.find((f) => f.status === 'FINISHED')!;
    expect(finished.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maps a genuine 0-0 FINISHED match to zero goals, never null — the case that actually distinguishes "not played" from "goalless draw"', async () => {
    const raw = snap('fd-matches-pl-2025') as { matches: Array<{ id: number; status: string; score?: { fullTime?: { home: number | null; away: number | null } } }> };
    const rawZeroZero = raw.matches.find(
      (m) => m.status === 'FINISHED' && m.score?.fullTime?.home === 0 && m.score?.fullTime?.away === 0,
    );
    // Verified against the real 2025-26 PL snapshot: 27 genuine 0-0 finishes exist.
    expect(rawZeroZero).toBeDefined();

    const { client } = clientFor(raw);
    const out = await client.getMatches('PL', 2025);
    const mapped = out.find((f) => f.fdId === rawZeroZero!.id)!;
    expect(mapped).toBeDefined();
    expect(mapped.status).toBe('FINISHED');
    expect(mapped.homeGoals).toBe(0);
    expect(mapped.awayGoals).toBe(0);
    expect(mapped.homeGoals).not.toBeNull();
    expect(mapped.awayGoals).not.toBeNull();
  });
});

describe('FootballDataClient.getScorers', () => {
  it('reproduces the top scorer\'s real fields exactly — would catch a goals/assists/playedMatches field swap', async () => {
    const raw = snap('fd-scorers-pl-2025') as {
      scorers: Array<{
        player: { id: number; name: string };
        team: { id: number };
        goals: number | null;
        assists: number | null;
        playedMatches: number | null;
      }>;
    };
    const rawTop = raw.scorers[0]!;

    const { client } = clientFor(raw);
    const out = await client.getScorers('PL', 2025);
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;

    // Exact-value assertions (not just `typeof`): goals, assists and
    // playedMatches are all numeric, so a mapping that swapped two of them
    // would still satisfy a bare `typeof === 'number'` check. Comparing
    // against the real fixture values catches that.
    expect(top.playerFdId).toBe(rawTop.player.id);
    expect(top.playerName).toBe(rawTop.player.name);
    expect(top.teamFdId).toBe(rawTop.team.id);
    expect(top.goals).toBe(rawTop.goals);
    expect(top.playedMatches).toBe(rawTop.playedMatches);
  });

  it('sends the season parameter and hits the scorers endpoint', async () => {
    const { client, calls } = clientFor(snap('fd-scorers-pl-2025'));
    await client.getScorers('PL', 2025);
    expect(calls[0]).toContain('/competitions/PL/scorers');
    expect(calls[0]).toContain('season=2025');
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-scorers-pl-2025'), {
      'x-requests-available-minute': '4',
    });
    await client.getScorers('PL', 2025);
    expect(limiter.available).toBe(4);
  });

  it('maps assists to null, never 0, when football-data.org sends assists: null', async () => {
    // Verified against the real snapshot: football-data.org sends the key
    // present with an explicit `null` value (not omitted) for 5 of the 50
    // returned scorers — low-minutes players it has no assist data for.
    const raw = snap('fd-scorers-pl-2025') as { scorers: Array<{ player: { id: number }; assists: number | null }> };
    const rawNullAssists = raw.scorers.find((s) => s.assists === null);
    expect(rawNullAssists).toBeDefined();

    const { client } = clientFor(raw);
    const out = await client.getScorers('PL', 2025);
    const mapped = out.find((s) => s.playerFdId === rawNullAssists!.player.id)!;
    expect(mapped).toBeDefined();
    expect(mapped.assists).toBeNull();
  });
});

describe('FootballDataClient.getStandings', () => {
  it('maps the TOTAL table, not HOME or AWAY — verified against a fixture with all three groups', async () => {
    const raw = snap('fd-standings-pl') as {
      standings: Array<{
        type: string;
        table: Array<{ position: number; team: { id: number }; playedGames: number; points: number }>;
      }>;
    };
    const totalGroup = raw.standings.find((g) => g.type === 'TOTAL');
    const homeGroup = raw.standings.find((g) => g.type === 'HOME');
    const awayGroup = raw.standings.find((g) => g.type === 'AWAY');
    expect(totalGroup).toBeDefined();
    expect(homeGroup).toBeDefined();
    expect(awayGroup).toBeDefined();

    // Confirm `played` is a genuine discriminator in this fixture (not an
    // assumption): a completed 38-game season shows TOTAL.played = 38 while
    // HOME/AWAY each show 19 (one leg apiece). Note: in this real fixture
    // TOTAL happens to sit at index 0 of `standings`, so it is located here
    // by `.find(type === 'TOTAL')` rather than by index — that keeps the
    // assertions below meaningful even though index-0 luck can't be ruled
    // out for this particular snapshot.
    expect(totalGroup!.table[0]!.playedGames).toBe(38);
    expect(homeGroup!.table[0]!.playedGames).toBe(19);
    expect(awayGroup!.table[0]!.playedGames).toBe(19);

    const { client } = clientFor(raw);
    const rows = await client.getStandings('PL', 2025);
    expect(rows).toHaveLength(20);
    expect(rows[0]!.position).toBe(1);
    expect(rows[0]!.points).toBeGreaterThan(0);

    // `played` distinguishes TOTAL (38) from HOME/AWAY (19) — this fails if
    // getStandings picks the wrong group.
    expect(rows[0]!.played).toBe(38);
    // Cross-check the mapped row against the raw TOTAL group directly,
    // located by type rather than by array index.
    expect(rows[0]!.points).toBe(totalGroup!.table[0]!.points);
    expect(rows[0]!.teamFdId).toBe(totalGroup!.table[0]!.team.id);
  });
});

describe('FootballDataClient.getSquad', () => {
  it('returns the team and its squad members', async () => {
    const { client } = clientFor(snap('fd-team-57'));
    const { team, squad } = await client.getSquad(57);
    expect(team.fdId).toBe(57);
    expect(team.crestUrl).toContain('crests.football-data.org');
    expect(squad.length).toBeGreaterThan(20);
    expect(squad[0]!.name).toBeTruthy();
  });
});

describe('FootballDataClient error handling', () => {
  it('throws with status and body on a non-2xx response', async () => {
    const fetchImpl = (async () =>
      new Response('{"message":"nope"}', { status: 403 })) as unknown as typeof fetch;
    const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, sleep: async () => {} });
    const client = new FootballDataClient({ apiKey: 'k', limiter, fetchImpl });
    await expect(client.getMatches('PL', 2026)).rejects.toThrow(/403.*nope/s);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npm test -- tests/providers/footballData.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/footballData'`

- [ ] **Step 5: Implement `lib/providers/footballData.ts`**

```ts
import type { RateLimiter } from '@/lib/ingest/rateLimiter';
import type {
  LeagueCode, FixtureStatus, RawFixture, RawStanding,
  RawSquadMember, RawScorer, RawTeam,
} from '@/lib/providers/types';

const BASE = 'https://api.football-data.org/v4';

export interface FootballDataOptions {
  apiKey: string;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
}

export class FootballDataClient {
  private readonly apiKey: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FootballDataOptions) {
    this.apiKey = opts.apiKey;
    this.limiter = opts.limiter;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    await this.limiter.acquire();
    const res = await this.fetchImpl(`${BASE}${path}`, {
      headers: { 'X-Auth-Token': this.apiKey },
    });
    this.limiter.syncFromHeaders(res.headers);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`football-data.org ${res.status} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async getMatches(code: LeagueCode, season: number): Promise<RawFixture[]> {
    const data = await this.get<{ matches?: unknown[] }>(
      `/competitions/${code}/matches?season=${season}`,
    );
    return (data.matches ?? []).map((m) => mapFixture(m as FdMatch, code, season));
  }

  async getStandings(code: LeagueCode, season: number): Promise<RawStanding[]> {
    const data = await this.get<{ standings?: FdStandingGroup[] }>(
      `/competitions/${code}/standings?season=${season}`,
    );
    const total = (data.standings ?? []).find((g) => g.type === 'TOTAL') ?? data.standings?.[0];
    return (total?.table ?? []).map((r) => ({
      teamFdId: r.team.id,
      position: r.position,
      played: r.playedGames,
      won: r.won,
      drawn: r.draw,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDifference: r.goalDifference,
      points: r.points,
      form: r.form ?? null,
    }));
  }

  async getSquad(teamFdId: number): Promise<{ team: RawTeam; squad: RawSquadMember[] }> {
    const t = await this.get<FdTeam>(`/teams/${teamFdId}`);
    return {
      team: {
        fdId: t.id,
        name: t.name,
        shortName: t.shortName ?? null,
        tla: t.tla ?? null,
        crestUrl: t.crest ?? null,
        venue: t.venue ?? null,
        founded: t.founded ?? null,
        clubColors: t.clubColors ?? null,
      },
      squad: (t.squad ?? []).map((p) => ({
        fdId: p.id,
        name: p.name,
        position: p.position ?? null,
        nationality: p.nationality ?? null,
        dateOfBirth: p.dateOfBirth ?? null,
      })),
    };
  }

  async getScorers(code: LeagueCode, season: number): Promise<RawScorer[]> {
    const data = await this.get<{ scorers?: FdScorer[] }>(
      `/competitions/${code}/scorers?season=${season}&limit=50`,
    );
    return (data.scorers ?? []).map((s) => ({
      playerFdId: s.player.id,
      playerName: s.player.name,
      teamFdId: s.team.id,
      goals: s.goals ?? null,
      assists: s.assists ?? null,
      playedMatches: s.playedMatches ?? null,
    }));
  }
}

function mapFixture(m: FdMatch, code: LeagueCode, season: number): RawFixture {
  return {
    fdId: m.id,
    leagueCode: code,
    season,
    kickoffUtc: m.utcDate,
    status: m.status as FixtureStatus,
    matchday: m.matchday ?? null,
    homeTeamFdId: m.homeTeam.id,
    awayTeamFdId: m.awayTeam.id,
    homeGoals: m.score?.fullTime?.home ?? null,
    awayGoals: m.score?.fullTime?.away ?? null,
    halfTimeHome: m.score?.halfTime?.home ?? null,
    halfTimeAway: m.score?.halfTime?.away ?? null,
    lastUpdated: m.lastUpdated ?? null,
  };
}

interface FdMatch {
  id: number; utcDate: string; status: string; matchday?: number;
  homeTeam: { id: number }; awayTeam: { id: number };
  score?: { fullTime?: { home: number | null; away: number | null };
            halfTime?: { home: number | null; away: number | null } };
  lastUpdated?: string;
}
interface FdStandingGroup {
  type: string;
  table: Array<{
    position: number; team: { id: number }; playedGames: number; won: number;
    draw: number; lost: number; goalsFor: number; goalsAgainst: number;
    goalDifference: number; points: number; form?: string | null;
  }>;
}
interface FdTeam {
  id: number; name: string; shortName?: string; tla?: string; crest?: string;
  venue?: string; founded?: number; clubColors?: string;
  squad?: Array<{ id: number; name: string; position?: string; nationality?: string; dateOfBirth?: string }>;
}
interface FdScorer {
  player: { id: number; name: string }; team: { id: number };
  goals?: number | null; assists?: number | null; playedMatches?: number | null;
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/providers/footballData.test.ts`
Expected: PASS, 15 tests (7 original + 4 covering the played-match mapping path against the fully-played 2025-26 season, including the discriminating genuine-0-0 case, + 4 covering `getScorers`)

- [ ] **Step 7: Commit**

```bash
git add lib/providers/types.ts lib/providers/footballData.ts tests/providers/footballData.test.ts tests/fixtures/
git commit -m "feat: football-data.org adapter with recorded-response tests"
```

---

### Task 5: FPL adapter (Premier League player statistics)

**Files:**
- Create: `lib/providers/fpl.ts`
- Create: `tests/fixtures/fpl-bootstrap.json`
- Test: `tests/providers/fpl.test.ts`

**Interfaces:**
- Consumes: nothing (keyless, unmetered).
- Produces:
  - `interface FplPlayer { fplId: number; name: string; webName: string; teamFplId: number; position: string; minutes: number; goals: number; assists: number; expectedGoals: number | null; photoUrl: string | null }`
  - `class FplClient { constructor(opts?: { fetchImpl?: typeof fetch }); getPlayers(): Promise<FplPlayer[]> }`

- [ ] **Step 1: Capture the snapshot**

```bash
curl -s "https://fantasy.premierleague.com/api/bootstrap-static/" -o tests/fixtures/fpl-bootstrap.json
node -e "const j=require('./tests/fixtures/fpl-bootstrap.json');console.log('players',j.elements.length,'teams',j.teams.length)"
```

Expected: `players 5xx teams 20`

- [ ] **Step 2: Write the failing test**

Create `tests/providers/fpl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FplClient } from '@/lib/providers/fpl';

const bootstrap = JSON.parse(readFileSync('tests/fixtures/fpl-bootstrap.json', 'utf8'));

function clientFor(body: unknown) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  return new FplClient({ fetchImpl });
}

describe('FplClient.getPlayers', () => {
  it('returns every player with statistics', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    expect(players.length).toBeGreaterThan(400);
    const p = players[0]!;
    expect(typeof p.fplId).toBe('number');
    expect(p.name).toBeTruthy();
    expect(typeof p.minutes).toBe('number');
  });

  it('maps element_type to a readable position', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    const positions = new Set(players.map((p) => p.position));
    for (const pos of positions) {
      expect(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']).toContain(pos);
    }
  });

  it('builds a photo URL from the photo code', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    const withPhoto = players.find((p) => p.photoUrl !== null)!;
    expect(withPhoto.photoUrl).toMatch(/^https:\/\/resources\.premierleague\.com\/.*\.png$/);
    expect(withPhoto.photoUrl).not.toContain('.jpg');
  });

  it('returns null rather than 0 when expected_goals is absent', async () => {
    const players = await clientFor({
      elements: [{ id: 1, first_name: 'A', second_name: 'B', web_name: 'AB', team: 1, element_type: 3, minutes: 90, goals_scored: 1, assists: 0, photo: '1.jpg' }],
      teams: [], events: [],
    }).getPlayers();
    expect(players[0]!.expectedGoals).toBeNull();
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(new FplClient({ fetchImpl }).getPlayers()).rejects.toThrow(/503/);
  });

  it('returns 0 rather than null when expected_goals is present and zero', async () => {
    // Fixture element id 1 (David Raya Martín) has expected_goals: "0.00".
    // This guards against the regression xg || null, which would turn 0 into null.
    const raw = bootstrap.elements.find((e: { id: number }) => e.id === 1);
    expect(raw).toBeDefined();
    expect(raw!.expected_goals).toBe('0.00');

    const players = await clientFor(bootstrap).getPlayers();
    const raya = players.find((p) => p.fplId === 1)!;
    expect(raya).toBeDefined();
    expect(raya.expectedGoals).toBe(0);
    expect(raya.expectedGoals).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/providers/fpl.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/fpl'`

- [ ] **Step 4: Implement `lib/providers/fpl.ts`**

```ts
const BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const POSITIONS: Record<number, string> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
};

export interface FplPlayer {
  fplId: number;
  name: string;
  webName: string;
  teamFplId: number;
  position: string;
  minutes: number;
  goals: number;
  assists: number;
  expectedGoals: number | null;
  photoUrl: string | null;
}

export class FplClient {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getPlayers(): Promise<FplPlayer[]> {
    const res = await this.fetchImpl(BOOTSTRAP);
    if (!res.ok) throw new Error(`FPL API ${res.status} for bootstrap-static`);
    const data = (await res.json()) as { elements?: FplElement[] };
    return (data.elements ?? []).map(mapPlayer);
  }
}

function mapPlayer(e: FplElement): FplPlayer {
  const xg = e.expected_goals === undefined ? null : Number.parseFloat(String(e.expected_goals));
  return {
    fplId: e.id,
    name: `${e.first_name} ${e.second_name}`.trim(),
    webName: e.web_name,
    teamFplId: e.team,
    position: POSITIONS[e.element_type] ?? 'Unknown',
    minutes: e.minutes ?? 0,
    goals: e.goals_scored ?? 0,
    assists: e.assists ?? 0,
    expectedGoals: xg === null || Number.isNaN(xg) ? null : xg,
    photoUrl: e.photo
      ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${e.photo.replace(/\.jpg$/, '')}.png`
      : null,
  };
}

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number;
  minutes?: number;
  goals_scored?: number;
  assists?: number;
  expected_goals?: string | number;
  photo?: string;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/providers/fpl.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add lib/providers/fpl.ts tests/providers/fpl.test.ts tests/fixtures/fpl-bootstrap.json
git commit -m "feat: FPL adapter for Premier League player statistics"
```

---

### Task 6: RSS adapter with deduplication and classification

**Files:**
- Create: `lib/providers/rss.ts`
- Create: `tests/fixtures/rss-bbc.xml`
- Test: `tests/providers/rss.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface NewsItem { source: string; title: string; summary: string | null; url: string; imageUrl: string | null; publishedAt: string; categories: string[]; contentHash: string }`
  - `const FEEDS: Array<{ source: string; url: string }>`
  - `function classify(title: string): string[]` — returns any of `'transfer'`, `'injury'`
  - `function contentHash(title: string): string`
  - `class RssClient { constructor(opts?: { fetchImpl?: typeof fetch }); fetchFeed(source: string, url: string): Promise<NewsItem[]>; fetchAll(): Promise<NewsItem[]> }`

- [ ] **Step 1: Capture the snapshot**

```bash
curl -s -A "Mozilla/5.0" "https://feeds.bbci.co.uk/sport/football/rss.xml" -o tests/fixtures/rss-bbc.xml
grep -c "<item" tests/fixtures/rss-bbc.xml
```

Expected: a count above 20.

- [ ] **Step 2: Write the failing test**

Create `tests/providers/rss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RssClient, classify, contentHash } from '@/lib/providers/rss';

const xml = readFileSync('tests/fixtures/rss-bbc.xml', 'utf8');

function clientFor(body: string) {
  const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  return new RssClient({ fetchImpl });
}

describe('classify', () => {
  it('tags transfer stories', () => {
    expect(classify('Arsenal complete £60m signing of midfielder')).toContain('transfer');
    expect(classify('Real Madrid agree deal for winger')).toContain('transfer');
  });
  it('tags injury stories', () => {
    expect(classify('Haaland ruled out for six weeks with hamstring injury')).toContain('injury');
  });
  it('returns an empty array for ordinary match reports', () => {
    expect(classify('Liverpool beat Everton in the Merseyside derby')).toEqual([]);
  });
  it('is case-insensitive', () => {
    expect(classify('CHELSEA COMPLETE SIGNING OF STRIKER')).toContain('transfer');
  });
});

describe('contentHash', () => {
  it('is stable for the same headline', () => {
    expect(contentHash('Same headline')).toBe(contentHash('Same headline'));
  });
  it('ignores case and surrounding whitespace so syndicated copies collapse', () => {
    expect(contentHash('  Same Headline ')).toBe(contentHash('same headline'));
  });
  it('differs for different headlines', () => {
    expect(contentHash('A')).not.toBe(contentHash('B'));
  });
});

describe('RssClient.fetchFeed', () => {
  it('parses items into NewsItem records', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    expect(items.length).toBeGreaterThan(10);
    const i = items[0]!;
    expect(i.source).toBe('BBC Sport');
    expect(i.title).toBeTruthy();
    expect(i.url).toMatch(/^https?:\/\//);
    expect(i.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(i.contentHash).toHaveLength(64);
  });

  it('assigns every item a hash unique to its title', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    const titles = new Set(items.map((i) => i.title.trim().toLowerCase()));
    const hashes = new Set(items.map((i) => i.contentHash));
    expect(hashes.size).toBe(titles.size);
  });

  it('returns an empty array instead of throwing when a feed is unreachable', async () => {
    const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/providers/rss.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/rss'`

- [ ] **Step 4: Implement `lib/providers/rss.ts`**

```ts
import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

export const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/football/rss' },
  { source: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
];

const TRANSFER_WORDS = [
  'transfer', 'signing', 'signs', 'sign ', 'move to', 'joins', 'deal for',
  'bid for', 'agree deal', 'medical', 'loan', 'fee', 'complete',
];
const INJURY_WORDS = [
  'injury', 'injured', 'ruled out', 'sidelined', 'hamstring', 'acl',
  'surgery', 'setback', 'out for', 'fitness',
];

export function classify(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (TRANSFER_WORDS.some((w) => t.includes(w))) out.push('transfer');
  if (INJURY_WORDS.some((w) => t.includes(w))) out.push('injury');
  return out;
}

export function contentHash(title: string): string {
  return createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

export interface NewsItem {
  source: string;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
  categories: string[];
  contentHash: string;
}

export class RssClient {
  private readonly fetchImpl: typeof fetch;
  private readonly parser = new Parser({
    customFields: { item: [['media:thumbnail', 'mediaThumbnail', { keepArray: false }]] },
  });

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async fetchFeed(source: string, url: string): Promise<NewsItem[]> {
    let xml: string;
    try {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 Touchline' } });
      if (!res.ok) return [];
      xml = await res.text();
    } catch {
      return [];
    }

    let feed: Awaited<ReturnType<Parser['parseString']>>;
    try {
      feed = await this.parser.parseString(xml);
    } catch {
      return [];
    }

    const items: NewsItem[] = [];
    for (const item of feed.items ?? []) {
      const title = item.title?.trim();
      const link = item.link?.trim();
      if (!title || !link) continue;
      const published = item.isoDate ?? item.pubDate;
      items.push({
        source,
        title,
        summary: item.contentSnippet?.trim() ?? null,
        url: link,
        imageUrl: extractImage(item),
        publishedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
        categories: classify(title),
        contentHash: contentHash(title),
      });
    }
    return items;
  }

  async fetchAll(): Promise<NewsItem[]> {
    const batches = await Promise.all(FEEDS.map((f) => this.fetchFeed(f.source, f.url)));
    const seen = new Set<string>();
    const merged: NewsItem[] = [];
    for (const item of batches.flat()) {
      if (seen.has(item.contentHash)) continue;
      seen.add(item.contentHash);
      merged.push(item);
    }
    return merged;
  }
}

function extractImage(item: Record<string, unknown>): string | null {
  const thumb = item.mediaThumbnail as { $?: { url?: string } } | undefined;
  if (thumb?.$?.url) return thumb.$.url;
  const enclosure = item.enclosure as { url?: string } | undefined;
  return enclosure?.url ?? null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/providers/rss.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
git add lib/providers/rss.ts tests/providers/rss.test.ts tests/fixtures/rss-bbc.xml
git commit -m "feat: RSS adapter with dedupe and transfer/injury classification"
```

---

### Task 7: Match-window guard

**Files:**
- Create: `lib/ingest/matchWindow.ts`
- Test: `tests/ingest/matchWindow.test.ts`

**Interfaces:**
- Consumes: `FixtureStatus`, `IN_PLAY_STATUSES` (Task 4).
- Produces:
  - `interface WindowFixture { status: FixtureStatus; kickoffUtc: string }`
  - `function isMatchWindowOpen(fixtures: WindowFixture[], now: Date, leadMinutes?: number, trailMinutes?: number): boolean`

The guard opens 15 minutes before the earliest kickoff and stays open until 150 minutes after the latest kickoff, or while any fixture reports `IN_PLAY`/`PAUSED`. This is what stops the live job spending requests on an empty Tuesday.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest/matchWindow.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/ingest/matchWindow.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ingest/matchWindow'`

- [ ] **Step 3: Implement `lib/ingest/matchWindow.ts`**

```ts
import { IN_PLAY_STATUSES, type FixtureStatus } from '@/lib/providers/types';

export interface WindowFixture {
  status: FixtureStatus;
  kickoffUtc: string;
}

const DEAD_STATUSES: FixtureStatus[] = ['POSTPONED', 'CANCELLED', 'SUSPENDED'];

export function isMatchWindowOpen(
  fixtures: WindowFixture[],
  now: Date,
  leadMinutes = 15,
  trailMinutes = 150,
): boolean {
  const relevant = fixtures.filter((f) => !DEAD_STATUSES.includes(f.status));
  if (relevant.length === 0) return false;

  if (relevant.some((f) => IN_PLAY_STATUSES.includes(f.status))) return true;

  const times = relevant.map((f) => new Date(f.kickoffUtc).getTime());
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const t = now.getTime();

  return t >= earliest - leadMinutes * 60_000 && t <= latest + trailMinutes * 60_000;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/ingest/matchWindow.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/matchWindow.ts tests/ingest/matchWindow.test.ts
git commit -m "feat: match-window guard so live polling costs nothing off-matchday"
```

---

### Task 8: Repository layer

**Files:**
- Create: `lib/db/repositories/leagues.ts`, `teams.ts`, `players.ts`, `fixtures.ts`, `standings.ts`, `playerStats.ts`, `news.ts`, `runs.ts`
- Create: `lib/db/slug.ts`
- Test: `tests/db/slug.test.ts`, `tests/db/repositories.integration.test.ts`

**Interfaces:**
- Consumes: `serviceClient()` (Task 2), domain types (Task 4), `NewsItem` (Task 6).
- Produces:
  - `slugify(name: string): string`
  - `upsertLeagues(rows: LeagueRow[]): Promise<void>`
  - `upsertTeams(rows: TeamRow[]): Promise<void>`
  - `upsertPlayersByFdId(rows: PlayerRow[]): Promise<void>` — squad members from football-data
  - `upsertPlayersByFplId(rows: PlayerRow[]): Promise<void>` — Premier League players from FPL
  - `upsertFixtures(rows: FixtureRow[]): Promise<void>`
  - `upsertStandings(rows: StandingRow[]): Promise<void>`
  - `upsertPlayerSeasonStats(rows: PlayerStatsRow[]): Promise<void>`
  - `upsertNewsItems(items: NewsItem[]): Promise<number>` — returns count newly inserted
  - `getTeamIdMap(): Promise<Map<number, number>>` — football-data id → internal id
  - `getLeagueIdMap(): Promise<Map<string, number>>` — league code → internal id
  - `getPlayerIdByFdId(): Promise<Map<number, number>>` — football-data id → internal id
  - `getPlayerIdByFplId(): Promise<Map<number, number>>` — FPL id → internal id
  - `getWindowFixtures(now?: Date): Promise<WindowFixture[]>`
  - `startRun(job: string): Promise<number>`, `finishRun(id: number, status: 'ok'|'error', message: string|null, requestsUsed: number): Promise<void>`

- [ ] **Step 1: Write the slug test**

Create `tests/db/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify } from '@/lib/db/slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Manchester United FC')).toBe('manchester-united-fc');
  });
  it('strips diacritics so accented names get clean URLs', () => {
    expect(slugify('Atlético Madrid')).toBe('atletico-madrid');
    expect(slugify('Borussia Mönchengladbach')).toBe('borussia-monchengladbach');
  });
  it('removes punctuation', () => {
    expect(slugify('Brighton & Hove Albion')).toBe('brighton-hove-albion');
  });
  it('collapses repeated separators and trims them', () => {
    expect(slugify('  A --  B  ')).toBe('a-b');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/db/slug.test.ts`
Expected: FAIL — `Cannot find module '@/lib/db/slug'`

- [ ] **Step 3: Implement `lib/db/slug.ts`**

```ts
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run the slug tests**

Run: `npm test -- tests/db/slug.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Implement the repositories**

Create `lib/db/repositories/leagues.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export interface LeagueRow {
  fd_code: string;
  fd_id: number;
  slug: string;
  name: string;
  country: string;
  emblem_url: string | null;
  current_season: number;
  season_start: string | null;
  season_end: string | null;
}

export async function upsertLeagues(rows: LeagueRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient()
    .from('leagues')
    .upsert(rows, { onConflict: 'fd_code' });
  if (error) throw new Error(`upsertLeagues: ${error.message}`);
}

export async function getLeagueIdMap(): Promise<Map<string, number>> {
  const { data, error } = await serviceClient().from('leagues').select('id, fd_code');
  if (error) throw new Error(`getLeagueIdMap: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_code as string, r.id as number]));
}
```

Create `lib/db/repositories/teams.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export interface TeamRow {
  fd_id: number;
  league_id: number;
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
  venue: string | null;
  founded: number | null;
  club_colors: string | null;
}

export async function upsertTeams(rows: TeamRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('teams').upsert(rows, { onConflict: 'fd_id' });
  if (error) throw new Error(`upsertTeams: ${error.message}`);
}

export async function getTeamIdMap(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient().from('teams').select('id, fd_id');
  if (error) throw new Error(`getTeamIdMap: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_id as number, r.id as number]));
}
```

Create `lib/db/repositories/fixtures.ts`:

```ts
import { serviceClient } from '@/lib/db/client';
import type { WindowFixture } from '@/lib/ingest/matchWindow';
import type { FixtureStatus } from '@/lib/providers/types';

export interface FixtureRow {
  fd_id: number;
  league_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  season: number;
  kickoff_utc: string;
  status: string;
  matchday: number | null;
  home_goals: number | null;
  away_goals: number | null;
  half_time_home: number | null;
  half_time_away: number | null;
  last_updated: string | null;
  updated_at: string;
}

export async function upsertFixtures(rows: FixtureRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = serviceClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('fixtures').upsert(rows.slice(i, i + 500), { onConflict: 'fd_id' });
    if (error) throw new Error(`upsertFixtures: ${error.message}`);
  }
}

/** Fixtures near enough to now that the guard needs to consider them. */
export async function getWindowFixtures(now = new Date()): Promise<WindowFixture[]> {
  const from = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  const { data, error } = await serviceClient()
    .from('fixtures')
    .select('status, kickoff_utc')
    .gte('kickoff_utc', from)
    .lte('kickoff_utc', to);
  if (error) throw new Error(`getWindowFixtures: ${error.message}`);
  return (data ?? []).map((r) => ({
    status: r.status as FixtureStatus,
    kickoffUtc: r.kickoff_utc as string,
  }));
}
```

Create `lib/db/repositories/standings.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export interface StandingRow {
  league_id: number;
  team_id: number;
  season: number;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form: string | null;
  updated_at: string;
}

export async function upsertStandings(rows: StandingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient()
    .from('standings')
    .upsert(rows, { onConflict: 'league_id,season,team_id' });
  if (error) throw new Error(`upsertStandings: ${error.message}`);
}
```

Create `lib/db/repositories/players.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export interface PlayerRow {
  fd_id: number | null;
  fpl_id: number | null;
  team_id: number | null;
  slug: string;
  name: string;
  position: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  photo_url: string | null;
}

export async function upsertPlayersByFdId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('players').upsert(rows, { onConflict: 'fd_id' });
  if (error) throw new Error(`upsertPlayersByFdId: ${error.message}`);
}

export async function upsertPlayersByFplId(rows: PlayerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await serviceClient().from('players').upsert(rows, { onConflict: 'fpl_id' });
  if (error) throw new Error(`upsertPlayersByFplId: ${error.message}`);
}

export async function getPlayerIdByFplId(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient()
    .from('players').select('id, fpl_id').not('fpl_id', 'is', null);
  if (error) throw new Error(`getPlayerIdByFplId: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fpl_id as number, r.id as number]));
}

export async function getPlayerIdByFdId(): Promise<Map<number, number>> {
  const { data, error } = await serviceClient()
    .from('players').select('id, fd_id').not('fd_id', 'is', null);
  if (error) throw new Error(`getPlayerIdByFdId: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.fd_id as number, r.id as number]));
}
```

Create `lib/db/repositories/playerStats.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export interface PlayerStatsRow {
  player_id: number;
  league_id: number;
  season: number;
  source: 'fpl' | 'football-data';
  appearances: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  expected_goals: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  updated_at: string;
}

export async function upsertPlayerSeasonStats(rows: PlayerStatsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = serviceClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('player_season_stats')
      .upsert(rows.slice(i, i + 500), { onConflict: 'player_id,season,source' });
    if (error) throw new Error(`upsertPlayerSeasonStats: ${error.message}`);
  }
}
```

Create `lib/db/repositories/news.ts`:

```ts
import { serviceClient } from '@/lib/db/client';
import type { NewsItem } from '@/lib/providers/rss';

export async function upsertNewsItems(items: NewsItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((i) => ({
    source: i.source,
    title: i.title,
    summary: i.summary,
    url: i.url,
    image_url: i.imageUrl,
    published_at: i.publishedAt,
    categories: i.categories,
    content_hash: i.contentHash,
  }));
  const { data, error } = await serviceClient()
    .from('news_items')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`upsertNewsItems: ${error.message}`);
  return data?.length ?? 0;
}
```

Create `lib/db/repositories/runs.ts`:

```ts
import { serviceClient } from '@/lib/db/client';

export async function startRun(job: string): Promise<number> {
  const { data, error } = await serviceClient()
    .from('ingest_run')
    .insert({ job, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return data!.id as number;
}

export async function finishRun(
  id: number,
  status: 'ok' | 'error',
  message: string | null,
  requestsUsed: number,
): Promise<void> {
  const { error } = await serviceClient()
    .from('ingest_run')
    .update({ status, message, requests_used: requestsUsed, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`finishRun: ${error.message}`);
}
```

- [ ] **Step 6: Write the integration test**

Create `tests/db/repositories.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { serviceClient } from '@/lib/db/client';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const live = process.env.RUN_DB_TESTS === '1';
const d = live ? describe : describe.skip;

d('repositories against a real Supabase project', () => {
  beforeAll(async () => {
    await upsertLeagues([{
      fd_code: 'TEST', fd_id: 999999, slug: 'test-league', name: 'Test League',
      country: 'Testland', emblem_url: null, current_season: 2026,
      season_start: '2026-08-01', season_end: '2027-05-01',
    }]);
  });

  it('upserts a league idempotently', async () => {
    await upsertLeagues([{
      fd_code: 'TEST', fd_id: 999999, slug: 'test-league', name: 'Test League Renamed',
      country: 'Testland', emblem_url: null, current_season: 2026,
      season_start: '2026-08-01', season_end: '2027-05-01',
    }]);
    const map = await getLeagueIdMap();
    expect(map.has('TEST')).toBe(true);
  });

  it('upserts teams and returns an id map', async () => {
    const leagueId = (await getLeagueIdMap()).get('TEST')!;
    await upsertTeams([{
      fd_id: 999998, league_id: leagueId, slug: 'test-fc', name: 'Test FC',
      short_name: 'Test', tla: 'TST', crest_url: null, venue: null,
      founded: null, club_colors: null,
    }]);
    expect((await getTeamIdMap()).has(999998)).toBe(true);
  });

  it('upserts a fixture twice without duplicating it', async () => {
    const leagueId = (await getLeagueIdMap()).get('TEST')!;
    const teamId = (await getTeamIdMap()).get(999998)!;
    const row = {
      fd_id: 999997, league_id: leagueId, home_team_id: teamId, away_team_id: teamId,
      season: 2026, kickoff_utc: '2026-09-01T14:00:00Z', status: 'SCHEDULED',
      matchday: 1, home_goals: null, away_goals: null,
      half_time_home: null, half_time_away: null, last_updated: null,
      updated_at: new Date().toISOString(),
    };
    await upsertFixtures([row]);
    await upsertFixtures([{ ...row, status: 'FINISHED', home_goals: 2, away_goals: 1 }]);

    const { data, error } = await serviceClient()
      .from('fixtures').select('fd_id, status, home_goals').eq('fd_id', 999997);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);           // upserted, not duplicated
    expect(data![0]!.status).toBe('FINISHED'); // and the update landed
    expect(data![0]!.home_goals).toBe(2);
  });

  it('records a run', async () => {
    const id = await startRun('test-job');
    await finishRun(id, 'ok', null, 3);
    expect(id).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run the integration test against the real project**

```bash
RUN_DB_TESTS=1 npx dotenv -e .env.local -- npm test -- tests/db/repositories.integration.test.ts
```

Expected: PASS, 4 tests. Without `RUN_DB_TESTS=1` they skip, which is what keeps CI free of live calls.

- [ ] **Step 8: Clean up the test rows**

In the Supabase SQL Editor:

```sql
delete from fixtures where fd_id = 999997;
delete from teams    where fd_id = 999998;
delete from leagues  where fd_code = 'TEST';
delete from ingest_run where job = 'test-job';
```

- [ ] **Step 9: Commit**

```bash
git add lib/db/ tests/db/
git commit -m "feat: repository layer with idempotent upserts"
```

---

### Task 9: Backfill script

**Files:**
- Create: `scripts/backfill.ts`
- Create: `lib/ingest/leagueSeed.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a populated database. No exported API.

This is the one-time run that makes every later job cheap: it seeds the five leagues, every club, every squad, and the complete 2025-26 season so no page is empty before kickoff.

- [ ] **Step 1: Write `lib/ingest/leagueSeed.ts`**

```ts
import type { LeagueCode } from '@/lib/providers/types';

export interface LeagueSeed {
  code: LeagueCode;
  fdId: number;
  slug: string;
  name: string;
  country: string;
}

/** football-data.org competition ids, verified 2026-08-03. */
export const LEAGUE_SEEDS: LeagueSeed[] = [
  { code: 'PL',  fdId: 2021, slug: 'premier-league', name: 'Premier League', country: 'England' },
  { code: 'PD',  fdId: 2014, slug: 'la-liga',        name: 'La Liga',        country: 'Spain' },
  { code: 'SA',  fdId: 2019, slug: 'serie-a',        name: 'Serie A',        country: 'Italy' },
  { code: 'BL1', fdId: 2002, slug: 'bundesliga',     name: 'Bundesliga',     country: 'Germany' },
  { code: 'FL1', fdId: 2015, slug: 'ligue-1',        name: 'Ligue 1',        country: 'France' },
];

export const CURRENT_SEASON = 2026;
export const PREVIOUS_SEASON = 2025;
```

- [ ] **Step 2: Write `scripts/backfill.ts`**

```ts
import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, CURRENT_SEASON, PREVIOUS_SEASON } from '@/lib/ingest/leagueSeed';
import { slugify } from '@/lib/db/slug';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap, type TeamRow } from '@/lib/db/repositories/teams';
import { upsertPlayersByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import type { RawSquadMember } from '@/lib/providers/types';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('backfill');
let requests = 0;

try {
  console.log('1/4  seeding leagues');
  await upsertLeagues(LEAGUE_SEEDS.map((s) => ({
    fd_code: s.code, fd_id: s.fdId, slug: s.slug, name: s.name, country: s.country,
    emblem_url: `https://crests.football-data.org/${s.code}.png`,
    current_season: CURRENT_SEASON, season_start: null, season_end: null,
  })));
  const leagueIds = await getLeagueIdMap();

  // Phase 1: discover every club and its squad. Last season's table is the
  // cheapest complete roster of clubs in a league (the current table may be
  // empty before matchday 1).
  console.log('2/4  clubs and squads');
  const collectedTeams: TeamRow[] = [];
  const collectedSquads: Array<{ teamFdId: number; squad: RawSquadMember[] }> = [];

  for (const s of LEAGUE_SEEDS) {
    const table = await fd.getStandings(s.code, PREVIOUS_SEASON); requests++;
    const leagueId = leagueIds.get(s.code)!;
    for (const row of table) {
      const { team, squad } = await fd.getSquad(row.teamFdId); requests++;
      collectedTeams.push({
        fd_id: team.fdId, league_id: leagueId, slug: slugify(team.name), name: team.name,
        short_name: team.shortName, tla: team.tla, crest_url: team.crestUrl,
        venue: team.venue, founded: team.founded, club_colors: team.clubColors,
      });
      collectedSquads.push({ teamFdId: team.fdId, squad });
    }
    console.log(`     ${s.code}: ${table.length} clubs`);
  }

  // Phase 2: write clubs, then resolve ids ONCE, then write players.
  await upsertTeams(collectedTeams);
  const teamIds = await getTeamIdMap();

  await upsertPlayersByFdId(collectedSquads.flatMap(({ teamFdId, squad }) =>
    squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(teamFdId) ?? null,
      slug: `${slugify(p.name)}-${p.fdId}`, name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    }))));
  console.log(`     ${collectedTeams.length} clubs, ${collectedSquads.reduce((n, c) => n + c.squad.length, 0)} players`);

  // Phase 3: fixtures for both seasons. Fetched once each, not twice.
  console.log('3/4  fixtures');
  for (const s of LEAGUE_SEEDS) {
    for (const season of [PREVIOUS_SEASON, CURRENT_SEASON]) {
      const matches = await fd.getMatches(s.code, season); requests++;
      await upsertFixtures(matches.map((m) => ({
        fd_id: m.fdId, league_id: leagueIds.get(s.code)!,
        home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
        away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
        season, kickoff_utc: m.kickoffUtc, status: m.status, matchday: m.matchday,
        home_goals: m.homeGoals, away_goals: m.awayGoals,
        half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
        last_updated: m.lastUpdated, updated_at: now(),
      })));
      console.log(`     ${s.code} ${season}: ${matches.length} fixtures`);
    }
  }

  console.log('4/4  last season final tables');
  for (const s of LEAGUE_SEEDS) {
    const rows = await fd.getStandings(s.code, PREVIOUS_SEASON); requests++;
    await upsertStandings(rows.map((r) => ({
      league_id: leagueIds.get(s.code)!, team_id: teamIds.get(r.teamFdId)!,
      season: PREVIOUS_SEASON, position: r.position, played: r.played, won: r.won,
      drawn: r.drawn, lost: r.lost, goals_for: r.goalsFor, goals_against: r.goalsAgainst,
      goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
    })).filter((r) => r.team_id !== undefined));
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`\nBackfill complete. ${requests} requests used.`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('\nBackfill failed:', message);
  process.exit(1);
}
```

- [ ] **Step 3: Run it**

```bash
npx tsx --env-file=.env.local scripts/backfill.ts
```

Expected: roughly 110–120 requests, taking about 12 minutes because the limiter paces to 10/min. Final line reports the request count.

- [ ] **Step 4: Verify the data landed**

In the Supabase SQL Editor:

```sql
select 'leagues' t, count(*) from leagues
union all select 'teams', count(*) from teams
union all select 'players', count(*) from players
union all select 'fixtures', count(*) from fixtures
union all select 'standings', count(*) from standings;
```

Expected roughly: leagues 5, teams ~98, players ~2500, fixtures ~3600, standings ~98.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill.ts lib/ingest/leagueSeed.ts
git commit -m "feat: one-time backfill of leagues, clubs, squads and 2025-26 history"
```

---

### Task 10: Scheduled ingestion jobs

**Files:**
- Create: `scripts/ingest/core.ts`, `scripts/ingest/players.ts`, `scripts/ingest/news.ts`, `scripts/ingest/live.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: four runnable entrypoints. Each logs a one-line summary and exits non-zero on failure so GitHub Actions marks the run red.

- [ ] **Step 1: Write `scripts/ingest/core.ts`**

```ts
import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { getPlayerIdByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('core');
let requests = 0;

try {
  const leagueIds = await getLeagueIdMap();
  const teamIds = await getTeamIdMap();
  const playerIds = await getPlayerIdByFdId();

  for (const s of LEAGUE_SEEDS) {
    const leagueId = leagueIds.get(s.code);
    if (leagueId === undefined) throw new Error(`league ${s.code} missing — run backfill first`);

    const matches = await fd.getMatches(s.code, CURRENT_SEASON); requests++;
    await upsertFixtures(matches.map((m) => ({
      fd_id: m.fdId, league_id: leagueId,
      home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
      away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
      season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
      matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
      half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
      last_updated: m.lastUpdated, updated_at: now(),
    })));

    const table = await fd.getStandings(s.code, CURRENT_SEASON); requests++;
    await upsertStandings(table
      .map((r) => ({
        league_id: leagueId, team_id: teamIds.get(r.teamFdId)!, season: CURRENT_SEASON,
        position: r.position, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
        goals_for: r.goalsFor, goals_against: r.goalsAgainst,
        goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
      }))
      .filter((r) => r.team_id !== undefined));

    // Top scorers are the ONLY free source of goals/assists outside the
    // Premier League. Without this, four of the five leagues have players
    // with no statistics at all. Fields FPL provides and this does not
    // (minutes, xG) are written as null, never as zero.
    const scorers = await fd.getScorers(s.code, CURRENT_SEASON); requests++;
    await upsertPlayerSeasonStats(scorers.flatMap((sc) => {
      const playerId = playerIds.get(sc.playerFdId);
      if (playerId === undefined) return [];
      return [{
        player_id: playerId, league_id: leagueId, season: CURRENT_SEASON,
        source: 'football-data' as const,
        appearances: sc.playedMatches, minutes: null,
        goals: sc.goals, assists: sc.assists, expected_goals: null,
        yellow_cards: null, red_cards: null, updated_at: now(),
      }];
    }));

    console.log(`${s.code}: ${matches.length} fixtures, ${table.length} table rows, ${scorers.length} scorers`);
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`core done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('core failed:', message);
  process.exit(1);
}
```

- [ ] **Step 2: Write `scripts/ingest/news.ts`**

```ts
import 'dotenv/config';
import { RssClient } from '@/lib/providers/rss';
import { upsertNewsItems } from '@/lib/db/repositories/news';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const runId = await startRun('news');

try {
  const items = await new RssClient().fetchAll();
  const inserted = await upsertNewsItems(items);
  await finishRun(runId, 'ok', `${items.length} fetched, ${inserted} new`, 0);
  console.log(`news done: ${items.length} fetched, ${inserted} new`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('news failed:', message);
  process.exit(1);
}
```

- [ ] **Step 3: Write `scripts/ingest/players.ts`**

```ts
import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { slugify } from '@/lib/db/slug';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertPlayersByFplId, getPlayerIdByFplId } from '@/lib/db/repositories/players';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { CURRENT_SEASON } from '@/lib/ingest/leagueSeed';

const runId = await startRun('players');
const now = () => new Date().toISOString();

try {
  const players = await new FplClient().getPlayers();
  const leagueId = (await getLeagueIdMap()).get('PL');
  if (leagueId === undefined) throw new Error('Premier League missing — run backfill first');

  await upsertPlayersByFplId(players.map((p) => ({
    fd_id: null, fpl_id: p.fplId, team_id: null,
    slug: `${slugify(p.name)}-fpl${p.fplId}`, name: p.name, position: p.position,
    nationality: null, date_of_birth: null, photo_url: p.photoUrl,
  })));

  const idByFpl = await getPlayerIdByFplId();
  await upsertPlayerSeasonStats(players.flatMap((p) => {
    const playerId = idByFpl.get(p.fplId);
    if (playerId === undefined) return [];
    return [{
      player_id: playerId, league_id: leagueId, season: CURRENT_SEASON, source: 'fpl' as const,
      appearances: null, minutes: p.minutes, goals: p.goals, assists: p.assists,
      expected_goals: p.expectedGoals, yellow_cards: null, red_cards: null, updated_at: now(),
    }];
  }));

  await finishRun(runId, 'ok', `${players.length} players`, 0);
  console.log(`players done: ${players.length}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('players failed:', message);
  process.exit(1);
}
```

- [ ] **Step 4: Write `scripts/ingest/live.ts`**

Five-minute cron is the GitHub Actions minimum, so this job polls in a short internal loop to reach finer resolution during a match window.

```ts
import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { isMatchWindowOpen } from '@/lib/ingest/matchWindow';
import { LEAGUE_SEEDS, CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertFixtures, getWindowFixtures } from '@/lib/db/repositories/fixtures';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const POLLS = 4;
const GAP_MS = 60_000;

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runId = await startRun('live');
let requests = 0;

try {
  const window = await getWindowFixtures();
  if (!isMatchWindowOpen(window, new Date())) {
    await finishRun(runId, 'ok', 'no match window open, skipped', 0);
    console.log('live: no match window open, skipped');
    process.exit(0);
  }

  const leagueIds = await getLeagueIdMap();
  const teamIds = await getTeamIdMap();

  for (let poll = 0; poll < POLLS; poll++) {
    for (const s of LEAGUE_SEEDS) {
      const matches = await fd.getMatches(s.code, CURRENT_SEASON); requests++;
      const active = matches.filter((m) =>
        ['IN_PLAY', 'PAUSED', 'FINISHED'].includes(m.status));
      if (active.length === 0) continue;
      await upsertFixtures(active.map((m) => ({
        fd_id: m.fdId, league_id: leagueIds.get(s.code)!,
        home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
        away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
        season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
        matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
        half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
        last_updated: m.lastUpdated, updated_at: now(),
      })));
    }
    if (poll < POLLS - 1) await sleep(GAP_MS);
  }

  await finishRun(runId, 'ok', `${POLLS} polls`, requests);
  console.log(`live done, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('live failed:', message);
  process.exit(1);
}
```

- [ ] **Step 5: Run each job once locally**

```bash
npx tsx --env-file=.env.local scripts/ingest/news.ts
npx tsx --env-file=.env.local scripts/ingest/players.ts
npx tsx --env-file=.env.local scripts/ingest/live.ts
npx tsx --env-file=.env.local scripts/ingest/core.ts
```

Expected: news reports items fetched and new; players reports ~564; **live reports `no match window open, skipped`** (correct during preseason — this is the guard working); core reports fixtures and table rows per league.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest/
git commit -m "feat: core, news, players and guarded live ingestion jobs"
```

---

### Task 11: GitHub Actions workflows and CI

**Files:**
- Create: `.github/workflows/ci.yml`, `ingest-core.yml`, `ingest-news.yml`, `ingest-players.yml`, `ingest-live.yml`, `keepalive.yml`

**Interfaces:**
- Consumes: the four job entrypoints from Task 10.
- Produces: nothing importable. This is the deployment surface of phase A.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

No secrets are referenced, which guarantees CI makes no live provider calls.

- [ ] **Step 2: Write a reusable ingest workflow — `.github/workflows/ingest-core.yml`**

```yaml
name: ingest-core
on:
  schedule: [{ cron: '0 * * * *' }]
  workflow_dispatch:
concurrency:
  group: ingest-core
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/ingest/core.ts
        env:
          FOOTBALL_DATA_KEY: ${{ secrets.FOOTBALL_DATA_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 3: Write `.github/workflows/ingest-news.yml`**

```yaml
name: ingest-news
on:
  schedule: [{ cron: '*/15 * * * *' }]
  workflow_dispatch:
concurrency:
  group: ingest-news
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/ingest/news.ts
        env:
          FOOTBALL_DATA_KEY: ${{ secrets.FOOTBALL_DATA_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4: Write `.github/workflows/ingest-players.yml`**

```yaml
name: ingest-players
on:
  schedule: [{ cron: '30 */6 * * *' }]
  workflow_dispatch:
concurrency:
  group: ingest-players
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/ingest/players.ts
        env:
          FOOTBALL_DATA_KEY: ${{ secrets.FOOTBALL_DATA_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 5: Write `.github/workflows/ingest-live.yml`**

```yaml
name: ingest-live
on:
  schedule: [{ cron: '*/5 * * * *' }]
  workflow_dispatch:
concurrency:
  group: ingest-live
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/ingest/live.ts
        env:
          FOOTBALL_DATA_KEY: ${{ secrets.FOOTBALL_DATA_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 6: Write `keepalive.yml`**

GitHub disables scheduled workflows after 60 days without a repository commit. This prevents the whole pipeline silently stopping.

```yaml
name: keepalive
on:
  schedule: [{ cron: '0 3 1 * *' }]
  workflow_dispatch:
permissions:
  contents: write
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          date -u +"%Y-%m-%dT%H:%M:%SZ" > .keepalive
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .keepalive
          git commit -m "chore: keepalive so scheduled workflows stay enabled"
          git push
```

- [ ] **Step 7: Push and trigger each workflow manually**

```bash
git add .github/workflows/
git commit -m "feat: GitHub Actions ingestion schedules and CI"
git push -u origin main
```

Then in the repo's **Actions** tab, run each of `ingest-news`, `ingest-players`, `ingest-core`, `ingest-live` via **Run workflow**.

Expected: all four green. `ingest-live` should log `no match window open, skipped`.

- [ ] **Step 8: Confirm the pipeline recorded itself**

In the Supabase SQL Editor:

```sql
select job, status, message, requests_used, started_at
from ingest_run order by started_at desc limit 10;
```

Expected: rows for `news`, `players`, `core`, `live`, all with `status = 'ok'`.

---

### Task 12: Weekly squad refresh

**Files:**
- Create: `scripts/ingest/squads.ts`
- Create: `.github/workflows/ingest-squads.yml`

**Interfaces:**
- Consumes: `FootballDataClient.getSquad` (Task 4), repositories (Task 8), `LEAGUE_SEEDS` (Task 9).
- Produces: a runnable entrypoint. Nothing importable.

The August transfer window is when squads change most, so a squad list frozen at backfill time goes stale immediately. This costs 98 requests (one per club) and therefore runs weekly, never hourly.

- [ ] **Step 1: Write `scripts/ingest/squads.ts`**

```ts
import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { slugify } from '@/lib/db/slug';
import { serviceClient } from '@/lib/db/client';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertPlayersByFdId } from '@/lib/db/repositories/players';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });

const runId = await startRun('squads');
let requests = 0;

try {
  const { data, error } = await serviceClient().from('teams').select('fd_id');
  if (error) throw new Error(`load teams: ${error.message}`);
  const teamIds = await getTeamIdMap();

  let players = 0;
  for (const row of data ?? []) {
    const fdId = row.fd_id as number;
    const { team, squad } = await fd.getSquad(fdId); requests++;
    await upsertPlayersByFdId(squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(team.fdId) ?? null,
      slug: `${slugify(p.name)}-${p.fdId}`, name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    })));
    players += squad.length;
  }

  await finishRun(runId, 'ok', `${data?.length ?? 0} clubs, ${players} players`, requests);
  console.log(`squads done: ${data?.length ?? 0} clubs, ${players} players, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('squads failed:', message);
  process.exit(1);
}
```

- [ ] **Step 2: Run it locally**

```bash
npx tsx --env-file=.env.local scripts/ingest/squads.ts
```

Expected: ~98 clubs, ~2,500 players, ~98 requests, taking about 10 minutes at 10/min.

- [ ] **Step 3: Write `.github/workflows/ingest-squads.yml`**

```yaml
name: ingest-squads
on:
  schedule: [{ cron: '0 4 * * 1' }]
  workflow_dispatch:
concurrency:
  group: ingest-squads
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/ingest/squads.ts
        env:
          FOOTBALL_DATA_KEY: ${{ secrets.FOOTBALL_DATA_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest/squads.ts .github/workflows/ingest-squads.yml
git commit -m "feat: weekly squad refresh for the transfer window"
```

---

## Phase A: definition of done

- [ ] `npm test` passes with no live provider calls
- [ ] `npm run typecheck` clean
- [ ] Backfill complete: ~5 leagues, ~98 teams, ~2,500 players, ~3,600 fixtures, ~98 standings rows
- [ ] All five ingestion workflows green on manual dispatch (`core`, `news`, `players`, `live`, `squads`)
- [ ] `ingest_run` shows successful rows for every job
- [ ] `player_season_stats` contains rows from **both** sources — `fpl` for Premier League depth and `football-data` for top scorers in the other four leagues — confirming no league has zero player statistics
- [ ] `ingest-live` correctly skips during preseason, spending zero requests
- [ ] Sustained request rate never exceeds 10/minute

---

## Next

Phase B (the site) is a separate plan: `docs/superpowers/plans/2026-08-XX-phase-b-site.md`. It reads exclusively from the tables this phase populates and adds no provider dependencies.

**Open item carried forward:** live-score latency is unmeasurable until 2026-08-16 (La Liga's first matchday). On that date, compare `fixtures.last_updated` against real kickoff events and record the observed delay in spec §2.4.
