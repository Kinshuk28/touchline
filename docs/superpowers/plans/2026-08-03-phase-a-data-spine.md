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
  `Env = { FOOTBALL_DATA_KEY: string; SUPABASE_URL: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY: string }`.
  Throws `Error` with a readable message listing every invalid field.

**Amended 2026-08-03, post-branch-review:** `SUPABASE_ANON_KEY` is now
`optional` in the schema (was `z.string().min(20)` required). No code path
in this phase reads it — `lib/db/client.ts`'s `serviceClient()` only ever
uses `SUPABASE_SERVICE_ROLE_KEY` — so requiring it made `loadEnv` throw in
any context (e.g. a workflow after Task 11's amendment) that legitimately
never held it. Still typed and validated (`z.string().min(20).optional()`)
so a real value is still checked if one is present; still documented here
and injected where actually used, for Phase B's eventual client-side need.

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

> **SUPERSEDED 2026-08-03 (post-branch-review):** `SUPABASE_ANON_KEY` below is
> `z.string().min(20)` (required). The actual schema uses
> `z.string().min(20).optional()` — see the amendment above the "Interfaces"
> block for this task.

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
- Create: `supabase/migrations/0003_lock_down_ingest_observability.sql` (added 2026-08-03, post-branch-review — see below)
- Create: `supabase/migrations/0004_nullable_news_published_at.sql` (added 2026-08-03, player-identity/data-honesty pass — see below)
- Create: `lib/db/client.ts`
- Create: `scripts/verify-schema.ts`

**Interfaces:**
- Consumes: `loadEnv` from Task 1.
- Produces: `serviceClient(): SupabaseClient` — a Supabase client authenticated with the service role key, for use by all ingestion code.

**Added 2026-08-03, post-branch-review — `0003_lock_down_ingest_observability.sql`:**
`0002` gave `anon`/`authenticated` `SELECT` on all nine tables, including
`ingest_run` and `ingest_budget`. The whole-branch review flagged that
`lib/providers/footballData.ts` throws
`` `football-data.org ${status} for ${path}: ${body.slice(0, 200)}` `` — an
unfiltered slice of the upstream provider's own response body — and every
ingestion script's catch block writes `err.message` straight into
`ingest_run.message`. With `0002`'s grant in place, that column becomes
world-readable through PostgREST once Phase B ships the anon key to the
browser. There is no evidence football-data.org ever echoes the caller's
`X-Auth-Token` back in an error body — this is hardening against an
unobserved risk, not a confirmed leak — but it costs nothing to close.

`0003` revokes the `SELECT` grant and drops the read-only RLS policy for
`anon`/`authenticated` on exactly these two tables — every other table
(leagues, teams, players, fixtures, standings, player_season_stats,
news_items) keeps `0002`'s posture untouched, since those are the public
football data the site exists to serve. `service_role` is unaffected either
way (it bypasses RLS by design, and `0003` doesn't touch its grants). A
future `/status` page can read `ingest_run`/`ingest_budget` server-side with
the service-role key instead of through the anon-key PostgREST path.

**Do not fold `0003` into `0001` or `0002`** — both are already applied
against the live database; migrations are append-only from here. **This
migration has not been applied yet** — it must be run by hand via the
Supabase dashboard SQL Editor (or the Supabase CLI, with credentials this
phase's automation does not have); it is not part of `scripts/verify-schema.ts`
and nothing in CI applies it automatically.

**Added 2026-08-03, player-identity/data-honesty pass —
`0004_nullable_news_published_at.sql`:** `news_items.published_at` was
`not null`, and that constraint is what forced `lib/providers/rss.ts`'s
`safePublishedAt` to fabricate `new Date().toISOString()` (i.e. *now*) as an
article's publication date whenever a feed's date was absent or
unparseable — a guess stored as fact in the one column the news feed sorts
by. `0004` drops that `not null` constraint so the honest value, `null`,
can be stored instead. See the `safePublishedAt` amendment in Task 6 for the
full before/after and `lib/db/repositories/news.ts` for how the write path
tolerates both migration states in the meantime (skips the undated item
without crashing the batch until this migration is applied; stores `null`
once it is). **This migration has not been applied yet either** — same
by-hand process as `0003`, and it must be applied *after* `0003` (append-only
ordering). Once applied, any future read query doing
`ORDER BY published_at DESC` must say `DESC NULLS LAST` explicitly —
Postgres's default null ordering for `DESC` is `NULLS FIRST`, which would
otherwise put every undated story right back at the top of the feed. See the
migration file's own comment for the full reasoning.

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
- Create: `tests/fixtures/fd-competition-teams-pd.json`
- Test: `tests/providers/footballData.test.ts`

**Interfaces:**
- Consumes: `RateLimiter` (Task 3).
- Produces:
  - Types: `LeagueCode`, `FixtureStatus`, `RawFixture`, `RawStanding`, `RawSquadMember`, `RawScorer`
  - `class FootballDataClient { constructor(opts: { apiKey: string; limiter: RateLimiter; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }); getMatches(code: LeagueCode, season: number): Promise<RawFixture[]>; getMatchesAcrossLeagues(codes: LeagueCode[], dateFrom: string, dateTo: string, season: number): Promise<RawFixture[]>; getStandings(code: LeagueCode, season: number): Promise<RawStanding[]>; getCompetitionTeams(code: LeagueCode): Promise<RawTeam[]>; getSquad(teamFdId: number): Promise<{ team: RawTeam; squad: RawSquadMember[] }>; getScorers(code: LeagueCode, season: number): Promise<RawScorer[]> }`

**Amended 2026-08-03, closing the matchday 429 cascade found in the whole-branch
review:** the original `get<T>()` did `await this.limiter.acquire()` once,
then `if (!res.ok) throw` immediately on any non-2xx — no retry at all. The
per-key rate limit (10 req/min) is shared across every workflow that touches
`FOOTBALL_DATA_KEY` (`core`, `live`, `squads`, plus one-off scripts), and
until Task 11's concurrency fix (below) `ingest-core` and `ingest-live` could
run in the same provider minute. On a matchday that meant 10 (core) + 5
(one `live` poll) = 15 requests inside a single 10/min ceiling — the 11th got
a bare 429, which the old code turned straight into `status='error'` and a
red run, silently stalling standings/scorers during the exact hours people
are watching.

The fix has three parts, and they must all stay in place together — removing
any one reopens the cascade:

1. **Retry with backoff in `get<T>()`.** Up to `MAX_ATTEMPTS = 3` attempts.
   On `429` or `5xx`, wait and retry; on any other non-2xx (crucially `403`,
   which `squads.ts`/`backfill.ts` rely on to detect a relegated club) fail
   on the first attempt — retrying that would delay the exact signal those
   scripts need. The `X-RequestCounter-Reset` response header (seconds until
   the provider's own counter resets) drives the 429 backoff when present;
   a missing/unparseable header falls back to a full 60s window. A 5xx gets
   a short linear backoff (`1000ms * attempt`) since no reset semantics apply
   to it. `limiter.syncFromHeaders(res.headers)` runs after **every**
   response, success or failure — a 429's own headers are the freshest
   signal of how exhausted the shared key currently is. Exhausting all
   attempts throws with status, path, attempt count and response body, same
   shape as the original error.
2. **`getMatchesAcrossLeagues(codes, dateFrom, dateTo, season)`** — see
   Task 10's amendment for why this exists and the live probe that confirmed
   it works on the free tier.
3. **Shared `concurrency.group` across `ingest-core`/`ingest-live`/`ingest-squads`**
   — see Task 11's amendment.

New constructor option: `sleep?: (ms: number) => Promise<void>`, defaulting
to a real `setTimeout` wrapper, purely so tests can inject an instant no-op
sleep and assert on the computed backoff durations without a test actually
waiting. Tests: `tests/providers/footballData.test.ts`, describe blocks
`FootballDataClient retry with backoff` and
`FootballDataClient.getMatchesAcrossLeagues`.

**Why `getCompetitionTeams` exists (added during backfill rework, 2026-08-03):**
The original backfill discovered every club by walking last season's
standings and calling `getSquad` (→ `/teams/{id}`) for each row. That 403s
for any club that was relegated (or otherwise dropped) out of every
competition the free tier covers — confirmed live: RCD Mallorca (id 89)
403s on `/teams/89`, Real Madrid (id 86) does not, and Mallorca is absent
from the current `/competitions/PD/teams` listing. St. Pauli and Pisa hit
the identical failure in Bundesliga/Serie A. This is **not** a blanket
free-tier restriction on `/teams/{id}` — it is specifically clubs no longer
in a covered competition.

`GET /competitions/{code}/teams` works on the free tier and returns the
current season's ~20 clubs with full metadata (id, name, shortName, tla,
crest, venue, founded, clubColors) — but never a relegated club, and its
`squad` array is always empty. `getStandings`'s `team` object, by contrast,
already carries `{id, name, shortName, tla, crest}` for every row, including
relegated clubs — verified present for Mallorca — so a relegated club's
identity can be written with zero extra requests, straight from a call the
backfill already makes. Do not "simplify" this back to walking standings +
`getSquad` for club discovery — that is the exact bug this rework fixed.

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
sleep 7
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_KEY" \
  "https://api.football-data.org/v4/competitions/PD/teams" \
  -o tests/fixtures/fd-competition-teams-pd.json
```

Verify each file is real JSON, not an error body:

```bash
node -e "for (const f of ['fd-matches-pl','fd-standings-pl','fd-team-57','fd-matches-pl-2025','fd-scorers-pl-2025','fd-competition-teams-pd']) { const j = require('./tests/fixtures/'+f+'.json'); console.log(f, Object.keys(j).slice(0,4).join(',')); }"
```

`fd-competition-teams-pd.json` was captured 2026-08-03 (added during the
backfill rework): 20 current La Liga clubs, full metadata, `squad: []` on
every entry. Confirmed empirically: RCD Mallorca does not appear in this
list (it was relegated at the end of 2025-26) — that absence is exactly
what phase 3 of the backfill relies on to know a club needs the
standings-embedded fallback instead of `/teams/{id}`.

Expected: keys including `matches`, `standings`, `squad`, `matches`, `scorers` respectively.

**Why two more captures were needed:** `fd-matches-pl.json` is the 2026-27 season, captured before a ball was kicked (380 SCHEDULED, 0 FINISHED). It only proves the unplayed half of the null-vs-zero rule — that an unplayed match maps to `null` goals. The played half — a real match mapping to its actual goals, half-time score and `lastUpdated`, and specifically a genuine 0-0 FINISHED match mapping to `0` rather than `null` — was entirely untested. `fd-matches-pl-2025.json` (the complete, fully-played 2025-26 season: 380 FINISHED matches, 27 of them genuine 0-0 draws) closes that gap. Similarly, `getScorers` — the only free source of goals/assists for La Liga, Serie A, Bundesliga and Ligue 1 — had zero test coverage; `fd-scorers-pl-2025.json` (season=2025, since the 2026 season returns an empty scorers list) closes it. Both fixtures are committed alongside the code, same as the original three.

**Amended 2026-08-03, after the backfill (Task 9) revealed `getSquad` returns
an empty squad for every La Liga/Serie A club:** `RawScorer` gained six
nullable bio fields — `firstName`, `lastName`, `dateOfBirth`, `nationality`,
`position`, `shirtNumber` — mapped from the scorer entry's embedded `player`
object in `getScorers`. These were not needed while scorers were only used
for goals/assists on top of an existing squad-sourced player; once the
scorers list became the *only* source of players at all for two leagues
(see Task 9's follow-up note and Task 10), the payload's bio data is what
makes a real `players` row possible from a scorer entry alone. The request's
`limit` also moved from 50 to 100 — the API's actual ceiling, confirmed
live — which doubles the player coverage those two leagues get from this
path. A fresh fixture, `tests/fixtures/fd-scorers-pd-2025.json` (La Liga,
season 2025, limit 100, 100 entries), was captured because the existing PL
fixture (also captured at the time with limit 50) did not exercise every
field at a useful value — e.g. `shirtNumber` is null for the top scorer in
both fixtures, so the PD fixture's non-null example (Raphinha, shirt 7) is
what actually exercises that mapping in `tests/providers/footballData.test.ts`.
`position` was found to be `null` for every entry in both snapshots — the
mapping stores that faithfully rather than inventing a value.

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
  /**
   * Club identity fields embedded directly in the standings row's `team`
   * object. Present for every row, including clubs relegated out of every
   * competition the free tier covers (which would otherwise 403 on
   * `/teams/{id}`) — this is the zero-extra-request source of their
   * identity for the historical clubs table.
   */
  teamName: string;
  teamShortName: string | null;
  teamTla: string | null;
  teamCrestUrl: string | null;
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

  it('embeds the club identity fields from the row\'s team object — the zero-request source of a relegated club\'s metadata', async () => {
    // The backfill's historical-clubs phase relies on getStandings alone to
    // create a team row for a relegated club, with no follow-up request to
    // /teams/{id} (which 403s for clubs no longer in a covered competition).
    // That only works if name/shortName/tla/crest survive the mapping.
    const raw = snap('fd-standings-pl') as {
      standings: Array<{
        type: string;
        table: Array<{ team: { id: number; name: string; shortName: string; tla: string; crest: string } }>;
      }>;
    };
    const totalGroup = raw.standings.find((g) => g.type === 'TOTAL')!;
    const rawTeam = totalGroup.table[0]!.team;

    const { client } = clientFor(raw);
    const rows = await client.getStandings('PL', 2025);
    const row = rows[0]!;
    expect(row.teamName).toBe(rawTeam.name);
    expect(row.teamShortName).toBe(rawTeam.shortName);
    expect(row.teamTla).toBe(rawTeam.tla);
    expect(row.teamCrestUrl).toBe(rawTeam.crest);
  });
});

describe('FootballDataClient.getCompetitionTeams', () => {
  it('maps every current club with full metadata, straight from the competition teams endpoint', async () => {
    const raw = snap('fd-competition-teams-pd') as {
      teams: Array<{
        id: number; name: string; shortName: string; tla: string; crest: string;
        venue: string; founded: number; clubColors: string;
      }>;
    };
    expect(raw.teams.length).toBe(20);
    const rawFirst = raw.teams[0]!;

    const { client } = clientFor(raw);
    const out = await client.getCompetitionTeams('PD');
    expect(out).toHaveLength(20);
    const first = out[0]!;

    // Exact-value assertions against the real captured fixture (Athletic
    // Club), not guessed placeholders — catches a field mix-up that a bare
    // typeof check would miss.
    expect(first.fdId).toBe(rawFirst.id);
    expect(first.name).toBe(rawFirst.name);
    expect(first.crestUrl).toBe(rawFirst.crest);
    expect(first.venue).toBe(rawFirst.venue);
    expect(first.founded).toBe(rawFirst.founded);
    expect(first.name).toBe('Athletic Club');
    expect(first.crestUrl).toBe('https://crests.football-data.org/77.png');
    expect(first.venue).toBe('San Mamés');
    expect(first.founded).toBe(1898);
  });

  it('confirms RCD Mallorca — the club that 403s on /teams/{id} after relegation — is absent from the current teams listing', async () => {
    // This is the empirical basis for the historical-clubs phase: a
    // relegated club genuinely does not appear here, so its identity must
    // come from getStandings instead.
    const raw = snap('fd-competition-teams-pd') as { teams: Array<{ name: string }> };
    expect(raw.teams.some((t) => /mallorca/i.test(t.name))).toBe(false);
  });

  it('sends the auth header and hits the competition teams endpoint (no season param)', async () => {
    const { client, calls } = clientFor(snap('fd-competition-teams-pd'));
    await client.getCompetitionTeams('PD');
    expect(calls[0]).toContain('/competitions/PD/teams');
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-competition-teams-pd'), {
      'x-requests-available-minute': '6',
    });
    await client.getCompetitionTeams('PD');
    expect(limiter.available).toBe(6);
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

> **SUPERSEDED 2026-08-03 (post-branch-review):** the `get<T>` body below —
> `await acquire()` once, `if (!res.ok) throw` immediately — is the exact
> shape that caused the matchday 429 cascade (see the amendment note above
> the "Interfaces" block for this task). The actual file now retries 429/5xx
> up to 3 attempts with header-driven backoff, and adds
> `getMatchesAcrossLeagues`. Do not restore this snippet verbatim; read
> `lib/providers/footballData.ts` directly for the current implementation.

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

  // ORIGINAL, PRE-FIX BODY — see the SUPERSEDED note above. No retry at all:
  // a bare 429 or 5xx threw immediately, which is the mechanism behind the
  // matchday 429 cascade this branch-review fix closes.
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
      teamName: r.team.name,
      teamShortName: r.team.shortName ?? null,
      teamTla: r.team.tla ?? null,
      teamCrestUrl: r.team.crest ?? null,
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

  /**
   * The full current roster of clubs in a competition — the free tier's
   * only reliable per-club metadata source. Unlike `/teams/{id}`, this
   * endpoint does not 403 for clubs still in the competition, but it also
   * never lists a club that has dropped out of every competition the free
   * tier covers (e.g. relegated at the end of last season) — those must be
   * sourced from `getStandings` instead. The `squad` array on each entry is
   * always empty here; this call is metadata-only.
   */
  async getCompetitionTeams(code: LeagueCode): Promise<RawTeam[]> {
    const data = await this.get<{ teams?: FdTeam[] }>(`/competitions/${code}/teams`);
    return (data.teams ?? []).map((t) => ({
      fdId: t.id,
      name: t.name,
      shortName: t.shortName ?? null,
      tla: t.tla ?? null,
      crestUrl: t.crest ?? null,
      venue: t.venue ?? null,
      founded: t.founded ?? null,
      clubColors: t.clubColors ?? null,
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
    position: number;
    team: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
    playedGames: number; won: number;
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

**Added during the backfill rework (2026-08-03):** one more assertion on
the existing `getStandings` test (the embedded team-identity fields) plus a
new `getCompetitionTeams` describe block (4 tests: metadata mapping against
the real fixture, Mallorca's confirmed absence, the request URL, and the
rate-limit header sync) — 20 tests total.

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

> **SUPERSEDED 2026-08-03 (post-branch-review, data-honesty pass):** the
> snippet below defaults `position` to `'Unknown'` and `minutes`/`goals`/
> `assists` to `0` when the field is absent from the payload
> (`POSITIONS[e.element_type] ?? 'Unknown'`, `e.minutes ?? 0`, etc.). Both
> defaults fabricate data the provider never sent: a missing minutes/goals/
> assists field becomes an authoritative "this player has played 0
> minutes / scored 0 goals" (the branch was already careful about this exact
> failure mode for `expectedGoals` — see the test two steps below — and then
> committed it for the other three fields), and `'Unknown'` invents a
> position value even though `players.position` is nullable and `null` is
> the honest answer.
>
> It also under-reacts to a real shape in the data: `bootstrap-static`'s
> `elements` array carries a fifth `element_type` (5) for fantasy
> **managers** in any season where manager scoring exists, which
> `POSITIONS` has never mapped. Defaulting an unrecognised `element_type` to
> `'Unknown'` would store a manager as a player with a guessed position;
> the correct behaviour is to not create a player row for it at all.
>
> The actual `lib/providers/fpl.ts` fixes both: `FplPlayer.position` is
> `string | null` (`?? null`, not `?? 'Unknown'`); `minutes`/`goals`/
> `assists` are `number | null` (`?? null`, not `?? 0`) — a real reported `0`
> still survives as `0`, only a genuinely absent field becomes `null`; and
> `getBootstrap()` filters `elements` down to known playing-position
> `element_type`s (1–4) before mapping, so a manager (or any future
> non-playing type) is skipped entirely rather than stored. Read
> `lib/providers/fpl.ts` and `tests/providers/fpl.test.ts` directly — the
> snippet and test list below are retained only as a historical record of
> what this task originally shipped (and the fabrication it committed), not
> as the current test suite.

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

Create `tests/providers/rss.test.ts`. (Below is the test file as it stands after the
"fault isolation and classifier precision round 2" fix — see
`.superpowers/sdd/task-6-report.md` for the history of what changed and why: the
`RssClient.fetchAll` describe block now drives the real `fetchAll()` — including a
dedupe-collision-winner test and a one-feed-fails-doesn't-sink-the-others test — instead
of re-implementing its merge loop inline, and `classify` gained coverage for the
`'knock'`/`'strain'`/`'contract'` false positives and past-tense transfer verbs.)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RssClient, classify, contentHash, FEEDS } from '@/lib/providers/rss';

const xml = readFileSync('tests/fixtures/rss-bbc.xml', 'utf8');

function fetchImplFor(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
}

function clientFor(body: string) {
  return new RssClient({ fetchImpl: fetchImplFor(body) });
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
  it('does not tag ordinary match-report language as transfer or injury (fixed false positives)', () => {
    // Bare "complete" used to fire on any "complete a comeback/the double" match report.
    // It has been dropped in favour of specific phrases ("complete signing", "complete move").
    expect(classify('Arsenal complete comeback win over Spurs')).toEqual([]);
    expect(classify('Liverpool complete the double over Everton')).toEqual([]);
    // Bare "fee" used to fire on any unrelated "fee" story. Replaced by "transfer fee" /
    // "record fee".
    expect(classify('Referee fee dispute overshadows derby')).toEqual([]);
    // Bare "setback" used to fire on non-injury setbacks (a title race, a takeover bid).
    // Dropped entirely from INJURY_WORDS.
    expect(classify('Title race setback for City')).toEqual([]);
    // Bare "out for" used to fire on "out for revenge/blood/the win". Dropped in favour
    // of "ruled out", which already covers the real injury phrasing.
    expect(classify('United out for revenge in the derby')).toEqual([]);
    // Bare "fitness" used to fire on ordinary fitness-level commentary. Replaced by the
    // specific phrase "fitness doubt".
    expect(classify('Guardiola praises squad fitness levels')).toEqual([]);
  });
  it('does not let the short "acl" token match as a substring of unrelated words', () => {
    expect(classify('A spectacle at the Bernabeu')).toEqual([]);
    expect(classify('Miracle comeback stuns the champions')).toEqual([]);
  });
  it('does not tag the cup idiom "knock ... out of" as an injury (bare "knock" dropped)', () => {
    // "X knock Y out of the cup" is extremely common match-report language for
    // eliminating an opponent — nothing to do with an injury. Bare "knock" used to
    // match here even after the word-boundary fix, because the fix only ever
    // defended against the compound "knockout", not this separated form. The bare
    // token is gone; "picked up a knock" (a genuine injury phrase) remains.
    expect(classify('Arsenal knock Chelsea out of FA Cup')).toEqual([]);
    expect(classify('Manchester City knock Newcastle out of Carabao Cup')).toEqual([]);
  });
  it('does not tag managerial "under strain" as an injury (bare "strain" dropped)', () => {
    // "Klopp under strain after a run of poor results" is about job pressure, not a
    // muscle injury. Bare "strain" is gone; "muscle strain" / "hamstring strain"
    // remain as unambiguous injury phrases.
    expect(classify('Klopp under strain after run of poor results')).toEqual([]);
  });
  it('does not tag commercial/sponsorship contract stories as a transfer (bare "contract" dropped)', () => {
    // "Contract" is everywhere in football business writing that isn't a player
    // transfer — sponsorship, broadcast rights, image rights. Bare "contract" is
    // gone; "new contract" / "contract extension" / "signs contract" /
    // "contract talks" remain as unambiguous transfer-context phrases.
    expect(classify('Sponsor contract dispute overshadows kit launch')).toEqual([]);
  });
  it('tags past-tense transfer verbs ("signed for", "loaned to")', () => {
    // Past tense is at least as common as present tense in transfer headlines.
    // Bare "signed"/"joined" are deliberately not added (see the comment above
    // INJURY_WORDS in rss.ts) because they collide with non-transfer prose
    // ("legend's signed shirt", "players joined in celebration").
    expect(classify('Rice signed for Arsenal in club-record deal')).toContain('transfer');
    expect(classify('Striker loaned to Championship side')).toContain('transfer');
  });
  it('tags "signs new contract" via the specific contract phrase', () => {
    expect(classify('Haaland signs new contract at City')).toContain('transfer');
  });
  it('tags realistic transfer headlines', () => {
    expect(classify('Arsenal complete signing of midfielder')).toContain('transfer');
    expect(classify('Real Madrid agree deal for winger')).toContain('transfer');
    expect(classify('Chelsea complete £60m move for striker')).toContain('transfer');
    expect(classify('Wirtz set to join Bayern in £70m transfer')).toContain('transfer');
    expect(classify('Rice signs for Arsenal')).toContain('transfer');
  });
  it('tags realistic injury headlines', () => {
    expect(classify('Haaland ruled out for six weeks with hamstring injury')).toContain('injury');
    expect(classify('Saka faces surgery on knee')).toContain('injury');
    expect(classify('Rodri sidelined with cruciate ligament damage')).toContain('injury');
  });
  it('tags both transfer and injury when a headline carries both signals', () => {
    const tags = classify('Injured striker completes loan move to Roma');
    expect(tags).toContain('injury');
    expect(tags).toContain('transfer');
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

  it('returns an empty array instead of throwing on unparseable XML', async () => {
    const fetchImpl = (async () => new Response('not xml at all', { status: 200 })) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });

  it('returns an empty array instead of throwing when fetchImpl itself rejects (network/DNS failure)', async () => {
    // The third failure mode alongside non-2xx and unparseable XML: the fetch call
    // never even completes.
    const fetchImpl = (async () => {
      throw new Error('simulated DNS failure');
    }) as unknown as typeof fetch;
    const items = await new RssClient({ fetchImpl }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toEqual([]);
  });

  it('does not swap title and summary: title matches the <title>, summary matches the description text', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    const i = items[0]!;
    expect(i.title).toBe('FA set to withdraw support for Fifa president Infantino');
    expect(i.summary).toContain('Football Association');
    expect(i.title).not.toBe(i.summary);
  });

  it('resolves imageUrl to the media:thumbnail CDN url for a real fixture item', async () => {
    const items = await clientFor(xml).fetchFeed('BBC Sport', 'https://example.test/rss');
    // Pinned against the known first item in tests/fixtures/rss-bbc.xml — all 70
    // items in that fixture carry a media:thumbnail, and this was previously
    // completely uncovered.
    expect(items[0]!.imageUrl).toBe(
      'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/d0fe/live/77f3d980-8d91-11f1-800e-433295bded5e.jpg',
    );
  });

  it('yields a null imageUrl when an item has neither media:thumbnail nor enclosure', async () => {
    const body = feedXml([{ title: 'No image here', link: 'https://x.test/1' }]);
    const items = await new RssClient({ fetchImpl: fetchImplFor(body) }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toHaveLength(1);
    expect(items[0]!.imageUrl).toBeNull();
  });

  it('does not throw when an item carries an unparseable pubDate, and falls back to a valid timestamp', async () => {
    // Proves finding 1's per-item fix: a malformed date must not kill its own
    // feed's other items. Before the fix, `new Date('garbage-date').toISOString()`
    // threw an uncaught RangeError here, and fetchFeed's promise rejected instead
    // of resolving to [] or to the parsed items.
    const body = feedXml([
      { title: 'Healthy item before the bad one', link: 'https://x.test/1' },
      { title: 'Item with an unparseable pubDate', link: 'https://x.test/2', pubDate: 'garbage-date' },
      { title: 'Healthy item after the bad one', link: 'https://x.test/3' },
    ]);
    const items = await new RssClient({ fetchImpl: fetchImplFor(body) }).fetchFeed('X', 'https://example.test/rss');
    expect(items).toHaveLength(3);
    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy item before the bad one');
    expect(titles).toContain('Item with an unparseable pubDate');
    expect(titles).toContain('Healthy item after the bad one');
    const bad = items.find((i) => i.title === 'Item with an unparseable pubDate')!;
    expect(bad.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// Branches a fetchImpl over the three real FEEDS URLs so RssClient.fetchAll() itself
// (not a hand-rolled re-implementation of its dedupe loop) is what's under test.
function fetchImplForFeeds(bodies: { bbc?: string; guardian?: string; sky?: string }): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u === FEEDS[0]!.url) {
      if (bodies.bbc === undefined) throw new Error('simulated failure for BBC Sport');
      return new Response(bodies.bbc, { status: 200 });
    }
    if (u === FEEDS[1]!.url) {
      if (bodies.guardian === undefined) throw new Error('simulated failure for The Guardian');
      return new Response(bodies.guardian, { status: 200 });
    }
    if (u === FEEDS[2]!.url) {
      if (bodies.sky === undefined) throw new Error('simulated failure for Sky Sports');
      return new Response(bodies.sky, { status: 200 });
    }
    throw new Error(`unexpected feed url in test: ${u}`);
  }) as unknown as typeof fetch;
}

describe('RssClient.fetchAll', () => {
  it('collapses the same story syndicated across two of the three real feeds into a single item, keeping the first-listed feed\'s copy', async () => {
    const shared = 'Same Headline Across Feeds';
    const bbcBody = feedXml([{ title: shared, link: 'https://bbc.test/story' }]);
    const guardianBody = feedXml([{ title: 'Guardian-only headline', link: 'https://guardian.test/only' }]);
    // Sky Sports carries the same story as BBC Sport, syndicated with different
    // casing and a different URL — the real-world shape of a wire-copy duplicate.
    const skyBody = feedXml([{ title: shared.toUpperCase(), link: 'https://sky.test/story' }]);

    const client = new RssClient({
      fetchImpl: fetchImplForFeeds({ bbc: bbcBody, guardian: guardianBody, sky: skyBody }),
    });
    const items = await client.fetchAll();

    const matches = items.filter((i) => i.contentHash === contentHash(shared));
    expect(matches).toHaveLength(1); // collapsed, not duplicated
    // Pin which copy won the collision: FEEDS[0] is BBC Sport, and batches.flat()
    // preserves FEEDS order, so the first-seen (BBC Sport's) copy is kept.
    expect(matches[0]!.source).toBe('BBC Sport');
    expect(matches[0]!.url).toBe('https://bbc.test/story');
    // The non-duplicate story from the other feed still comes through untouched.
    expect(items.some((i) => i.title === 'Guardian-only headline')).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('still returns the other two feeds\' items when one feed has an item with an unparseable pubDate', async () => {
    // Proves finding 1's fetchAll-level fix: before the fix, an uncaught RangeError
    // thrown while formatting one item's date propagated out of fetchFeed(), and
    // Promise.all rejected the whole fetchAll() call — discarding the two healthy
    // feeds along with it. See the "old behaviour" note in the task report for
    // confirmation this reproduces against the pre-fix code.
    const bbcBody = feedXml([{ title: 'Healthy BBC story', link: 'https://bbc.test/1' }]);
    const guardianBody = feedXml([{ title: 'Healthy Guardian story', link: 'https://guardian.test/1' }]);
    const skyBody = feedXml([
      { title: 'Sky story with a bad date', link: 'https://sky.test/1', pubDate: 'garbage-date' },
    ]);

    const client = new RssClient({
      fetchImpl: fetchImplForFeeds({ bbc: bbcBody, guardian: guardianBody, sky: skyBody }),
    });
    const items = await client.fetchAll();

    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy BBC story');
    expect(titles).toContain('Healthy Guardian story');
    // The malformed-date item isn't dropped either — it's kept with a fallback
    // timestamp instead of taking its feed (or the whole call) down.
    expect(titles).toContain('Sky story with a bad date');
    expect(items).toHaveLength(3);
  });

  it('still returns the other two feeds\' items when one feed rejects outright (network/DNS failure)', async () => {
    const bbcBody = feedXml([{ title: 'Healthy BBC story', link: 'https://bbc.test/1' }]);
    const skyBody = feedXml([{ title: 'Healthy Sky story', link: 'https://sky.test/1' }]);

    // bodies.guardian left undefined -> fetchImplForFeeds throws for that URL.
    const client = new RssClient({ fetchImpl: fetchImplForFeeds({ bbc: bbcBody, sky: skyBody }) });
    const items = await client.fetchAll();

    const titles = items.map((i) => i.title);
    expect(titles).toContain('Healthy BBC story');
    expect(titles).toContain('Healthy Sky story');
    expect(items).toHaveLength(2);
  });
});

function feedXml(items: Array<{ title: string; link: string; pubDate?: string }>): string {
  const itemsXml = items
    .map(
      (it) =>
        `<item><title><![CDATA[${it.title}]]></title><link>${it.link}</link><description><![CDATA[summary]]></description><pubDate>${it.pubDate ?? 'Mon, 03 Aug 2026 07:49:33 GMT'}</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test Feed</title>${itemsXml}</channel></rss>`;
}
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/providers/rss.test.ts`
Expected: FAIL — `Cannot find module '@/lib/providers/rss'`

- [ ] **Step 4: Implement `lib/providers/rss.ts`**

(Below is the implementation as it stands after the "fault isolation and classifier
precision round 2" fix. Two changes from the first-draft version matter most: (1)
`fetchAll` uses `Promise.allSettled`, not `Promise.all`, and each item is built inside
its own `try/catch` with a `safePublishedAt()` helper that can never throw — together
these guarantee a feed being unreachable, or carrying one malformed date, never takes
down a run that's also reading two healthy feeds; (2) `TRANSFER_WORDS`/`INJURY_WORDS`
dropped the bare tokens `'contract'`, `'knock'`, and `'strain'` in favour of specific
phrases, and gained past-tense transfer phrases `'signed for'` / `'loaned to'`, because
each bare token had a common non-football-transfer/non-injury sense that was firing as
a false positive. See `.superpowers/sdd/task-6-report.md` for the full before/after and
the false-positive headlines that drove each change.)

```ts
import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

export const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/football/rss' },
  { source: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
];

// Multi-word phrases below are checked as plain substrings of the lowercased title: a
// real headline is very unlikely to contain a several-word phrase like "agree deal" or
// "ruled out" by accident, so no extra care is needed there. Single-word tokens (no
// internal space) are different — a short or common word can appear as a *substring
// inside an unrelated word* and fire a false positive, e.g. bare "acl" inside
// "spectacle"/"miracle"/"debacle"/"oracle", bare "signing" inside
// "resigning"/"designing"/"consigning" (a manager resigning is not a transfer), bare
// "knock" inside "knockout" (Champions League "knockout stages" is a very common
// football phrase), or bare "operation" inside "cooperation". To avoid that whole class
// of trap, every single-word keyword is matched with word boundaries (`\bword\b`)
// instead of a raw substring test. The trade-off: a bare plural like "transfers" or
// "injuries" no longer matches through its singular root ("transfer"/"injury") — in
// practice those headlines still carry other signal (another keyword, or the word
// elsewhere in the title), so the small recall loss is worth the precision gained.
//
// Beyond that word-boundary trap, some tokens are ambiguous even as *whole words* —
// they have a common non-football-news sense as well as the football sense:
//   - bare "knock" is also standard match-report idiom for eliminating an opponent
//     ("Arsenal knock Chelsea out of the FA Cup"), nothing to do with an injury.
//   - bare "strain" is also standard for managerial/off-pitch pressure ("Klopp under
//     strain after a run of poor results"), nothing to do with a muscle injury.
//   - bare "contract" is everywhere in football *business* writing that isn't a player
//     transfer at all — sponsorship deals, broadcast-rights deals, image-rights deals
//     ("Sponsor contract dispute overshadows kit launch").
// Word boundaries can't fix these, because the word itself is the false positive, not
// just a substring of it. So these three are dropped as bare tokens entirely and only
// kept as specific multi-word phrases that disambiguate the real signal.
const TRANSFER_WORDS = [
  'transfer', 'signing', 'signs for', 'signs with', 'signed for', 'set to join',
  'joins', 'loaned to', 'move to', 'move for', 'deal for', 'bid for',
  'agree deal', 'agrees deal', 'agreed deal', 'medical', 'loan',
  'release clause', 'transfer fee', 'record fee', 'swap deal',
  'complete signing', 'complete move', 'new contract', 'contract extension',
  'signs contract', 'contract talks',
];
const INJURY_WORDS = [
  'injury', 'injured', 'ruled out', 'sidelined', 'hamstring', 'acl',
  'cruciate', 'surgery', 'operation', 'out until', 'doubtful',
  'fitness doubt', 'muscle strain', 'hamstring strain', 'picked up a knock',
];
// Bare "signed" and bare "joined" were deliberately left out even though they're
// common past-tense transfer verbs: "signed" collides with memorabilia/autograph
// stories ("legend's signed shirt auctioned for charity") and "joined" collides with
// ordinary match-report prose ("players joined in celebration", "joined by his
// teammates"). "signed for" and "loaned to" above capture the same real signal
// (see the required-regression headlines) without those collisions.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompiled once at module load rather than per matchesKeyword() call: single-word
// terms need a `\bword\b` RegExp, multi-word phrases are checked as plain substrings
// and need no RegExp at all. Building `new RegExp` inside classify()'s hot path (once
// per keyword, per call) was wasted work since the word lists never change at runtime.
function compileMatchers(words: readonly string[]): Array<(t: string) => boolean> {
  return words.map((term) => {
    if (term.includes(' ')) return (t: string) => t.includes(term);
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
    return (t: string) => re.test(t);
  });
}

const TRANSFER_MATCHERS = compileMatchers(TRANSFER_WORDS);
const INJURY_MATCHERS = compileMatchers(INJURY_WORDS);

export function classify(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (TRANSFER_MATCHERS.some((m) => m(t))) out.push('transfer');
  if (INJURY_MATCHERS.some((m) => m(t))) out.push('injury');
  return out;
}

// SUPERSEDED 2026-08-03 (post-branch-review, data-honesty pass): the comment and
// implementation immediately below fall back to `new Date().toISOString()` -- i.e.
// *now* -- when a date is absent or unparseable, and call that a "safe, honest
// default." It is neither: it stores a fabricated guess as the article's real
// publication date, in the exact column `news_items` is sorted by
// (`news_published_idx on news_items (published_at desc)`). An article of genuinely
// unknown date would pin itself to the very top of the feed, ahead of stories that
// really are new -- the opposite of "safe." The honest value for "we don't know when
// this was published" is `null`, not a confident-looking timestamp.
//
// The actual `lib/providers/rss.ts` returns `null` from `safePublishedAt` instead
// (`NewsItem.publishedAt: string | null`), and migration `0004_nullable_news_
// published_at.sql` makes the column nullable to receive it -- see Task 2's
// migrations list and `lib/db/repositories/news.ts`'s `upsertNewsItems`, which
// tolerates both migration states (stores `null` once applied; skips the undated
// item without crashing the batch until then). Read those files directly; this
// comment and the function below are retained only as a historical record of the
// fabrication this task originally shipped.
function safePublishedAt(published: string | undefined): string {
  if (published) {
    const d = new Date(published);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
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
      // Defense in depth: a malformed item (bad date, unexpected field shape, or
      // anything else unanticipated) must not take down the rest of this feed's
      // items. Skip just this one and keep going. safePublishedAt() below already
      // guarantees the date itself can't throw, but this guard covers whatever we
      // haven't thought of too.
      try {
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
          publishedAt: safePublishedAt(published),
          categories: classify(title),
          contentHash: contentHash(title),
        });
      } catch {
        continue;
      }
    }
    return items;
  }

  async fetchAll(): Promise<NewsItem[]> {
    // Promise.allSettled, not Promise.all: a feed being unreachable (or any other
    // per-feed failure) must never throw, and one dead feed must not take down a run
    // that is also reading two healthy ones. fetchFeed() already catches its own
    // fetch/parse/item errors and resolves to [], so this is defense in depth — but it
    // is the line that actually enforces "never let one feed's rejection sink the
    // whole call" against future bugs in fetchFeed.
    const results = await Promise.allSettled(FEEDS.map((f) => this.fetchFeed(f.source, f.url)));
    const batches = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
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
Expected: PASS, 29 tests

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
  - `function isLiveRelevant(fixture: { status: FixtureStatus; kickoffUtc: string }, now: Date): boolean` — added during Task 10 (the live job needs a per-fixture "should this be upserted this poll" check; `isMatchWindowOpen` only answers "should the job run at all"). Not shown as a separate code block in this task originally — it lives in the same file and is exercised by the same test file.

The guard opens 15 minutes before the earliest kickoff and stays open until 150 minutes after the latest kickoff, or while any fixture reports `IN_PLAY`/`PAUSED`. This is what stops the live job spending requests on an empty Tuesday.

**Amended 2026-08-03, post-branch-review — `isLiveRelevant` disagreed with `isMatchWindowOpen` about SUSPENDED:**
`isMatchWindowOpen` deliberately treats `SUSPENDED` as not dead (see the
`DEAD_STATUSES` comment below — a suspension can resume as `IN_PLAY` on the
next poll, so the window must stay open through it), but the original
`isLiveRelevant` returned `false` for `SUSPENDED`. The two fixes disagreed:
the live job kept polling through a suspension (burning requests, correctly,
per `isMatchWindowOpen`) but never actually wrote the `SUSPENDED` status
(incorrectly, per the old `isLiveRelevant`) — so the site kept showing the
match as `IN_PLAY` until `core.ts`'s next hourly sweep corrected it. `AWARDED`
(a match awarded to a team, e.g. after a forfeit) has the identical shape: a
live-window transition the live job should be the fast writer for, not leave
for the hourly job.

Fix: `isLiveRelevant` now treats `SUSPENDED` and `AWARDED` as always relevant,
regardless of kickoff time — the same bucket as `IN_PLAY`/`PAUSED`, not the
trail-windowed `FINISHED` bucket. Both are rare, and both only ever arise on
a fixture already inside the live-polling window (a match must have started
to be suspended, or to be awarded after an abandonment), so there is no
FINISHED-style long-tail write-volume risk from treating them as unconditionally
relevant. Boundary tests (three weeks after kickoff, `isLiveRelevant` still
`true`) were added for both in `tests/ingest/matchWindow.test.ts`.

Also fixed in the same pass: `lib/ingest/matchWindow.ts` imported `RawFixture`
from `@/lib/providers/types` and never used it (dead import) — removed. It
had nothing to do with `WindowFixture`, which is this file's own, separate
interface.

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

  it('ignores postponed and cancelled fixtures (but not suspended) when deciding to open', () => {
    const f = [
      { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('a lone SUSPENDED fixture in-window opens the window (suspended matches can resume)', () => {
    const f = [{ status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('a lone SUSPENDED fixture far outside the window closes it (treated as scheduled)', () => {
    const f = [{ status: 'SUSPENDED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    expect(isMatchWindowOpen(f, at('2026-08-19T12:00:00Z'))).toBe(false);
  });

  it('postponed and cancelled together in-window still closes', () => {
    const f = [
      { status: 'POSTPONED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'CANCELLED' as const, kickoffUtc: '2026-08-21T15:00:00Z' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:30:00Z'))).toBe(false);
  });

  it('poisoning case: a genuinely in-window TIMED fixture plus an unparseable date still opens the window', () => {
    const f = [
      { status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T13:46:00Z'))).toBe(true);
  });

  it('in-play short-circuit survives an unparseable date on the same fixture', () => {
    const f = [{ status: 'IN_PLAY' as const, kickoffUtc: 'not-a-date' }];
    expect(isMatchWindowOpen(f, at('2026-08-21T20:00:00Z'))).toBe(true);
  });

  it('all rows unparseable returns false', () => {
    const f = [
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
      { status: 'TIMED' as const, kickoffUtc: 'also-not-a-date' },
    ];
    expect(isMatchWindowOpen(f, at('2026-08-21T14:00:00Z'))).toBe(false);
  });

  it('a bad date does not widen the window: in-window fixture alone vs with bad date', () => {
    const goodFixture = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    const withBadDate = [
      { status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' },
      { status: 'TIMED' as const, kickoffUtc: 'not-a-date' },
    ];
    expect(isMatchWindowOpen(goodFixture, at('2026-08-21T13:46:00Z'))).toBe(true);
    expect(isMatchWindowOpen(withBadDate, at('2026-08-21T13:46:00Z'))).toBe(true);
    expect(isMatchWindowOpen(goodFixture, at('2026-08-21T10:00:00Z'))).toBe(false);
    expect(isMatchWindowOpen(withBadDate, at('2026-08-21T10:00:00Z'))).toBe(false);
  });

  it('boundary: opens exactly 15 minutes before kickoff (pins >=)', () => {
    const f = [{ status: 'TIMED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    // Exactly 15 minutes before: 14:00:00 - 15min = 13:45:00
    expect(isMatchWindowOpen(f, at('2026-08-21T13:45:00Z'))).toBe(true);
  });

  it('boundary: closes exactly 150 minutes after the last kickoff (pins <=)', () => {
    const f = [{ status: 'FINISHED' as const, kickoffUtc: '2026-08-21T14:00:00Z' }];
    // Exactly 150 minutes after: 14:00:00 + 150min = 16:30:00
    expect(isMatchWindowOpen(f, at('2026-08-21T16:30:00Z'))).toBe(true);
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

// POSTPONED and CANCELLED are truly dead — fixtures will not resume.
// SUSPENDED is not dead: a match halted mid-play by floodlight failure, weather, or crowd trouble
// can resume as IN_PLAY on the very next poll. Treating it as dead would close the ingestion
// window while a real, resumable match is live, silently stopping live scores for all leagues.
// Keeping SUSPENDED "relevant" means its kickoff time contributes to the window bounds like SCHEDULED,
// ensuring the window stays open through the suspension and any resumption.
const DEAD_STATUSES: FixtureStatus[] = ['POSTPONED', 'CANCELLED'];

export function isMatchWindowOpen(
  fixtures: WindowFixture[],
  now: Date,
  leadMinutes = 15,
  trailMinutes = 150,
): boolean {
  const relevant = fixtures.filter((f) => !DEAD_STATUSES.includes(f.status));
  if (relevant.length === 0) return false;

  if (relevant.some((f) => IN_PLAY_STATUSES.includes(f.status))) return true;

  // Filter out fixtures with unparseable kickoff times; one NaN would poison
  // Math.min/max and break the guard for all other fixtures. The DB column
  // is `timestamptz not null`, so this shouldn't happen, but the function is
  // exported and pure — defensive filtering is appropriate here.
  const parseable = relevant.filter((f) => {
    const t = new Date(f.kickoffUtc).getTime();
    return !Number.isNaN(t);
  });
  if (parseable.length === 0) return false;

  const times = parseable.map((f) => new Date(f.kickoffUtc).getTime());
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

**PostgREST caps a plain `select` at 1,000 rows by default.** Any id-map helper
that reads a whole table (`getLeagueIdMap`, `getTeamIdMap`, `getPlayerIdByFdId`,
`getPlayerIdByFplId`) must page through results with `.range()` instead of doing
one unpaginated select — otherwise, once the table crosses 1,000 rows, the
helper silently returns a truncated `Map` with no error. This bit exactly this
project: with 2,600 rows seeded into `players`, `getPlayerIdByFdId()` returned
a map of only 1,000 entries, which downstream would mean fixtures written with
null team ids and player stats silently dropped for every player past the
first page. `leagues` (5 rows) and `teams` (~98 rows) are under the cap today,
but they share the identical pattern and must use the same paginated helper —
a future competition addition must not reintroduce the unpaginated version.

**Reworked 2026-08-03 after the live backfill died in phase 5 (squads).**
Postgres refuses an entire `INSERT ... ON CONFLICT DO UPDATE` statement — not
just the offending row — if that statement contains two rows that resolve to
the same conflict key: `ON CONFLICT DO UPDATE command cannot affect row a
second time`. The backfill hit this for real: a player who appeared in two
different clubs' squads (moved mid-window, or a provider data quirk) put the
same `fd_id` twice into one `upsertPlayersByFdId` call, and Postgres rejected
the whole ~2,500-row batch — zero players written, despite 110 teams having
just been seeded correctly. This is a hazard for *every* bulk upsert in this
file, not just the players one, because every one of them keys its `onConflict`
on a natural id that could in principle repeat within a single caller's batch.
**Do not remove `dedupeByKey` calls from these upserts as redundant** — without
it, any input containing so much as one repeated conflict key silently takes
down the entire batch, and that repeat can come from provider data, not just a
caller bug.

The fix is `lib/db/dedupe.ts`'s `dedupeByKey<T>(rows, keyOf)`: it collapses
rows sharing a key, last occurrence wins (later data is treated as fresher).
Every bulk upsert below calls it internally, keyed on its own `onConflict`
target, so callers never need to know this constraint exists:
`upsertPlayersByFdId`/`upsertPlayersByFplId` (`fd_id`/`fpl_id`),
`upsertTeams` (`fd_id`), `upsertFixtures` (`fd_id`), `upsertLeagues`
(`fd_code`), `upsertStandings` (`league_id,season,team_id`),
`upsertPlayerSeasonStats` (`player_id,season,source`), `upsertNewsItems`
(`content_hash`). For the two upserts that chunk their input into batches of
500 (`upsertFixtures`, `upsertPlayerSeasonStats`, and now also
`upsertPlayersByFdId`/`upsertPlayersByFplId`), the dedupe runs once across the
*whole* input before chunking — deduping per-chunk would still leave a
duplicate pair that straddles a chunk boundary intact, reproducing the exact
bug this fixes.

**Files:**
- Create: `lib/db/repositories/leagues.ts`, `teams.ts`, `players.ts`, `fixtures.ts`, `standings.ts`, `playerStats.ts`, `news.ts`, `runs.ts`
- Create: `lib/db/slug.ts`
- Create: `lib/db/paginate.ts` — shared `fetchAllRows()` helper that pages a select with `.range()` until a page returns fewer rows than the page size (1,000), so no id-map helper can silently truncate past PostgREST's default row cap
- Create: `lib/db/dedupe.ts` — shared `dedupeByKey<T>(rows: readonly T[], keyOf: (row: T) => string | number): T[]` helper, last-occurrence-wins, used inside every bulk upsert above to prevent a repeated conflict key from making Postgres reject an entire `ON CONFLICT DO UPDATE` batch
- Test: `tests/db/slug.test.ts`, `tests/db/dedupe.test.ts`, `tests/db/repositories.integration.test.ts`

**Interfaces:**
- Consumes: `serviceClient()` (Task 2), domain types (Task 4), `NewsItem` (Task 6).
- Produces:
  - `slugify(name: string): string`
  - `fetchAllRows<T>(context: string, fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize?: number): Promise<T[]>` — pages through `.range(from, to)` until a page comes back shorter than `pageSize`; guards against a non-terminating loop if a page unexpectedly returns more rows than requested
  - `dedupeByKey<T>(rows: readonly T[], keyOf: (row: T) => string | number): T[]` — collapses rows sharing a key, last occurrence wins; called inside every upsert below, keyed on that upsert's own `onConflict` target, so a repeated conflict key in a caller's batch never reaches Postgres as a rejected `ON CONFLICT DO UPDATE`
  - `upsertLeagues(rows: LeagueRow[]): Promise<void>` — deduped on `fd_code`
  - `upsertTeams(rows: TeamRow[]): Promise<void>` — deduped on `fd_id`
  - `upsertPlayersByFdId(rows: PlayerRow[]): Promise<void>` — squad members from football-data; deduped on `fd_id` across the whole input, then chunked in batches of 500
  - `upsertPlayersByFplId(rows: PlayerRow[]): Promise<void>` — Premier League players from FPL; deduped on `fpl_id` across the whole input, then chunked in batches of 500
  - `upsertFixtures(rows: FixtureRow[]): Promise<void>` — deduped on `fd_id` across the whole input, then chunked in batches of 500
  - `upsertStandings(rows: StandingRow[]): Promise<void>` — deduped on composite key `league_id,season,team_id`
  - `upsertPlayerSeasonStats(rows: PlayerStatsRow[]): Promise<void>` — deduped on composite key `player_id,season,source` across the whole input, then chunked in batches of 500
  - `upsertNewsItems(items: NewsItem[]): Promise<number>` — returns count newly inserted; deduped on `content_hash`
  - `getTeamIdMap(): Promise<Map<number, number>>` — football-data id → internal id; paginated via `fetchAllRows`, safe past 1,000 teams
  - `getLeagueIdMap(): Promise<Map<string, number>>` — league code → internal id; paginated via `fetchAllRows`, safe past 1,000 leagues
  - `getPlayerIdByFdId(): Promise<Map<number, number>>` — football-data id → internal id; paginated via `fetchAllRows`, safe past 1,000 players
  - `getPlayerIdByFplId(): Promise<Map<number, number>>` — FPL id → internal id; paginated via `fetchAllRows`, safe past 1,000 players
  - `getWindowFixtures(now?: Date): Promise<WindowFixture[]>` — deliberately left unpaginated: an 8-hour kickoff window across ~5 tracked leagues realistically returns tens of rows, nowhere near the 1,000-row cap
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

Create `lib/db/paginate.ts` first — the shared helper every id-map getter below
uses to stay correct once its table crosses PostgREST's 1,000-row default cap:

**Amended 2026-08-03, post-branch-review:** `PAGE_SIZE` below is `1000` —
exactly PostgREST's `max-rows` default. The loop terminates on
`page.length < pageSize`, so if `max-rows` is ever lowered server-side (a
plausible ops change, not a code change), every page would come back shorter
than `1000` and the very first page would look like "the last page" —
silently truncating every paginated read again, the identical data-loss bug
this module exists to fix, just moved one layer down. The actual code now
uses `PAGE_SIZE = 500`, leaving headroom under any `max-rows` value this
project is likely to run against. Use `500` if reproducing this file; do not
copy the `1000` shown below.

```ts
const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * PostgREST caps a plain `select` at 1,000 rows by default. A single
 * unpaginated select against a table past that cap does not error — it just
 * silently returns a truncated result set. `fetchAllRows` pages through
 * `fetchPage` with `.range(from, to)` until a page comes back shorter than
 * `pageSize`. Callers must apply a stable `.order(...)` on their query so row
 * order — and therefore which rows land on which page — stays consistent
 * across the separate requests that make up one pagination run.
 */
export async function fetchAllRows<T>(
  context: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  // Sanity cap so a misbehaving page (e.g. a server that ignores `range` and
  // always returns a full page) can't spin forever.
  const MAX_PAGES = 100_000;
  let pagesFetched = 0;

  for (;;) {
    if (pagesFetched >= MAX_PAGES) {
      throw new Error(`${context}: exceeded ${MAX_PAGES} pages while paginating — aborting to avoid a non-terminating loop`);
    }
    pagesFetched++;

    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(`${context}: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
    // Advance by rows actually received, not the assumed page size, so a
    // page that returns more than requested still makes forward progress.
    from += page.length;
  }

  return rows;
}
```

Create `lib/db/repositories/leagues.ts`:

```ts
import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';

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
  const rows = await fetchAllRows<{ id: number; fd_code: string }>(
    'getLeagueIdMap',
    (from, to) =>
      serviceClient().from('leagues').select('id, fd_code').order('id', { ascending: true }).range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_code, r.id]));
}
```

Create `lib/db/repositories/teams.ts`:

```ts
import { serviceClient } from '@/lib/db/client';
import { fetchAllRows } from '@/lib/db/paginate';

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
  const rows = await fetchAllRows<{ id: number; fd_id: number }>(
    'getTeamIdMap',
    (from, to) =>
      serviceClient().from('teams').select('id, fd_id').order('id', { ascending: true }).range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_id, r.id]));
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

/**
 * Fixtures near enough to now that the guard needs to consider them.
 *
 * Deliberately left unpaginated: this queries an 8-hour kickoff window
 * (±4 hours) across the ~5 leagues this app tracks. Even a fixture-congested
 * day with every tracked league kicking off simultaneously is on the order of
 * tens of matches, nowhere near PostgREST's 1,000-row default select cap
 * (see `lib/db/paginate.ts`). Pagination here would be complexity with no
 * corresponding risk.
 */
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
import { fetchAllRows } from '@/lib/db/paginate';

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
  const rows = await fetchAllRows<{ id: number; fpl_id: number }>(
    'getPlayerIdByFplId',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, fpl_id')
        .not('fpl_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  );
  return new Map(rows.map((r) => [r.fpl_id, r.id]));
}

export async function getPlayerIdByFdId(): Promise<Map<number, number>> {
  const rows = await fetchAllRows<{ id: number; fd_id: number }>(
    'getPlayerIdByFdId',
    (from, to) =>
      serviceClient()
        .from('players')
        .select('id, fd_id')
        .not('fd_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  );
  return new Map(rows.map((r) => [r.fd_id, r.id]));
}
```

**Why this matters:** with 2,600 rows seeded into `players`, the old unpaginated
`getPlayerIdByFdId()` returned a map of only 1,000 entries — no error, just a
silent partial result. Task 9's backfill and Task 10's ingestion jobs resolve
foreign keys through these maps, so a truncated map means fixtures written with
null team ids and player stats dropped for every player past the first 1,000.

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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from '@/lib/db/client';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { upsertPlayersByFdId, getPlayerIdByFdId, type PlayerRow } from '@/lib/db/repositories/players';

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

  // Delete the synthetic rows created by this test file so they never leak into
  // the real backfill (Task 9). Order matters: fixtures/teams reference leagues,
  // so children are removed before the parent.
  afterAll(async () => {
    const db = serviceClient();
    await db.from('fixtures').delete().eq('fd_id', 999997);
    await db.from('teams').delete().eq('fd_id', 999998);
    await db.from('leagues').delete().eq('fd_code', 'TEST');
    await db.from('ingest_run').delete().eq('job', 'test-job');
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

// PostgREST caps a plain `select` at 1,000 rows by default. `getPlayerIdByFdId`
// (like the other id-map helpers) used to do a single unpaginated select, so on
// a table with more than 1,000 rows it silently returned a partial map — no
// error, just missing entries. This seeds past that boundary to prove pages
// beyond the first are actually fetched, not just that a count matches.
d('getPlayerIdByFdId beyond the 1,000-row PostgREST cap', () => {
  const BASE_FD_ID = 90_000_000; // far outside any real football-data.org id range
  const SEED_COUNT = 1100;
  const BATCH_SIZE = 500;

  beforeAll(async () => {
    const rows: PlayerRow[] = Array.from({ length: SEED_COUNT }, (_, i) => ({
      fd_id: BASE_FD_ID + i,
      fpl_id: null,
      team_id: null,
      slug: `pg-cap-test-player-${i}`,
      name: `Pagination Cap Test Player ${i}`,
      position: null,
      nationality: null,
      date_of_birth: null,
      photo_url: null,
    }));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await upsertPlayersByFdId(rows.slice(i, i + BATCH_SIZE));
    }
  });

  afterAll(async () => {
    const db = serviceClient();
    await db.from('players').delete().gte('fd_id', BASE_FD_ID).lt('fd_id', BASE_FD_ID + SEED_COUNT);

    const { count, error } = await db
      .from('players')
      .select('*', { count: 'exact', head: true })
      .gte('fd_id', BASE_FD_ID)
      .lt('fd_id', BASE_FD_ID + SEED_COUNT);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it('returns all 1,100 seeded rows, including one from beyond the first page', async () => {
    const map = await getPlayerIdByFdId();
    const seededIds = [...map.keys()].filter((k) => k >= BASE_FD_ID && k < BASE_FD_ID + SEED_COUNT);

    expect(map.size).toBe(SEED_COUNT);
    expect(seededIds).toHaveLength(SEED_COUNT);

    // The 1,050th seeded player (index 1049) is past the first 1,000-row page.
    // A truncated, unpaginated select would never see it.
    expect(map.get(BASE_FD_ID + 1049)).toBeDefined();
  });
});
```

- [ ] **Step 7: Run the integration test against the real project**

```bash
RUN_DB_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/db/repositories.integration.test.ts
```

Expected: PASS, 6 tests (4 from the general repository suite, 1 for news-item
upsert count semantics, plus the 1,100-row pagination-cap test). Without
`RUN_DB_TESTS=1` they skip, which is what keeps CI free of live calls. All
`describe` blocks clean up their own synthetic rows in `afterAll` — including
deleting the seeded players/news items and asserting the count is back to 0 —
so no manual SQL cleanup step is needed.

- [ ] **Step 8: Commit**

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

**Reworked 2026-08-03 after the live run 403'd.** The original version
below (club discovery by walking last season's standings and calling
`getSquad` — i.e. `/teams/{id}` — for every row) fails partway through: any
club relegated at the end of 2025-26 is no longer in any competition the
free tier covers, and `/teams/{id}` 403s for it. Confirmed live: RCD
Mallorca (id 89) 403s, Real Madrid (id 86) does not; St. Pauli and Pisa hit
the identical failure in Bundesliga and Serie A. **This is not a blanket
free-tier restriction on `/teams/{id}`** — it is specifically clubs that
dropped out of every covered competition — so retrying or backing off does
not help; the discovery strategy itself has to change.

The fix restructures club discovery into two sources instead of one:
`getCompetitionTeams` (Task 4) for the ~98 current clubs (full metadata,
zero 403 risk), and the standings response's embedded `team` object for any
club in last season's table that isn't in the current listing (relegated
clubs — identity only, since `venue`/`founded`/`clubColors` are genuinely
absent from that payload). See Task 4 for the full API-level reasoning.
**Do not simplify this back to single-source discovery via `getSquad`** —
that reintroduces the exact bug this rework fixed.

**Reworked again 2026-08-03 after the live run died in phase 5 (squads).**
With the 403 fix above in place, the run got past clubs cleanly (5 leagues,
96 current + 14 historical-only clubs = 110 teams written) and then failed
on the very next step: `upsertPlayersByFdId: ON CONFLICT DO UPDATE command
cannot affect row a second time`. Postgres rejects an entire upsert
statement — not just the offending row — if it contains two rows resolving
to the same conflict key. The backfill collects every current club's squad
and upserts all of them in one call keyed on `fd_id`; a player who appears in
two clubs' squads (moved mid-window, or a provider data quirk) puts that
`fd_id` in the batch twice, and the whole ~2,500-row call was rejected —
zero players written despite the 110 teams above landing correctly.

This is a general hazard of every bulk upsert in the repository layer, not
specific to squads, so the fix lives in the repository layer (Task 8) rather
than here: every `upsert*` function in `lib/db/repositories/` now dedupes its
input on its own conflict key via `lib/db/dedupe.ts`'s `dedupeByKey`
(last-occurrence-wins) before it ever reaches Postgres, and
`upsertPlayersByFdId`/`upsertPlayersByFplId` now chunk in batches of 500 like
`upsertFixtures` and `upsertPlayerSeasonStats` already did. **This script does
not need to dedupe squads itself** — that would just be reimplementing what
the repository layer already guarantees for every caller. **Do not add
per-call-site dedupe here as a "belt and suspenders" measure** — it duplicates
logic that is already centralized and tested (`tests/db/dedupe.test.ts`,
`tests/db/repositories.integration.test.ts`).

One trade-off is worth recording rather than silently resolving: a player who
legitimately appears in two clubs' squads has an ambiguous `team_id` at
backfill time, and last-wins picks whichever club's squad the collection loop
happened to process last — arbitrary, not authoritative. For this dataset
(free-tier football-data.org squads across five leagues, one season boundary)
that is judged an acceptable trade-off: the count of affected players is
small, the ambiguity resolves itself at the next scheduled ingestion job once
the player's move is reflected in their new club's squad listing, and building
real reconciliation (e.g. "most recent squad listing wins" cross-referenced
against transfer data) is complexity this one-time backfill does not need.

**Follow-up gap found after this backfill ran (2026-08-03): `getSquad` returns
an empty `squad` array for every La Liga and Serie A club, not just the
relegated ones.** This is a different failure from the 403 rework above — no
error is thrown, phase 5 completes "successfully," and `collectedSquads`
genuinely contains a `squad: []` entry for every current PD/SA club (verified
live: Barcelona fd_id 81 squad 0, Inter fd_id 108 squad 0; a Premier League
club in the same call, Arsenal fd_id 57, squad 29 — so this is real,
league-specific, and not a client bug). Net effect: this backfill wrote
**zero player rows for La Liga's and Serie A's 23 clubs each**, silently,
because `upsertPlayersByFdId(collectedSquads.flatMap(...))` receives no rows
at all for those two leagues rather than an error — nothing here was equipped
to notice a whole league contributing 0 squad members.

The fix (Task 10 area, see `lib/ingest/scorerPlayers.ts` and
`scripts/ingest/seedScorerPlayers.ts`) does not touch this backfill script.
It was scoped as a **separate, dedicated script** rather than a new phase
appended to `backfill.ts`, deliberately: this backfill's phases 1-7 already
ran and are correct (110 teams, fixtures, standings all landed); re-running
the whole script to reach one new final phase would re-spend ~116 requests
re-fetching data that does not need to change, just to exercise a step that
did not exist when it first ran. `seedScorerPlayers.ts` re-fetches only
`getScorers` (season 2025, limit 100) per league — 5 requests — and creates
any player missing from the id map straight from the scorer entry's own
`player` object (bio fields, `null` where absent, `photo_url` always null —
football-data.org has no player photography). See Task 10 for the full
mechanism; it is identical in both the current-season (`core.ts`) and
previous-season (`seedScorerPlayers.ts`) paths.

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

Seven phases, in order — current clubs and historical clubs are
deliberately split into two sources (see the rework note above), team ids
are resolved exactly once after *both* club-writing phases have run, and a
403 on an individual club's squad fetch is caught, logged and counted
rather than aborting the whole run:

**Amended 2026-08-03, post-branch-review — two fixes to the code below:**

1. **Team slugs now use `slugWithFdId(name, fdId)` (`lib/db/slug.ts`), not
   plain `slugify(name)`.** The snippet below still shows
   `slug: slugify(team.name)` / `slug: slugify(row.teamName)` in phases 2 and
   3 — that is stale. `teams.slug` is `unique not null`, exactly like
   `players.slug`, which already used a `${slugify(name)}-${fdId}` suffix for
   this reason. No two of the current ~110 clubs collide today, but
   promotion/relegation churn is not guaranteed to keep it that way, and a
   collision would abort the *entire* `upsertTeams` batch (Postgres rejects
   the whole upsert on a unique-constraint conflict), not just the
   colliding row. Player slugs were already safe; team slugs were not — this
   closes that gap.
   **This changes existing slugs for already-backfilled clubs.** No separate
   migration/repair script was written: `upsertTeams` conflicts on `fd_id`
   and updates every column including `slug`, so simply re-running the
   backfill (or, for currently-covered clubs, letting `ingest-squads` run
   once — see Task 12's amendment, which now also calls `upsertTeams`) is a
   complete, idempotent repair. Do not treat re-running backfill as
   "unnecessary since the data already exists" — the slug column specifically
   needs that re-write.
2. **`requests++` moved before its paired `await fd.xxx(...)` call**, in
   every phase below (2, 3, 5, 6). As written in the snippet, `requests++`
   sits *after* the await — so a call that itself throws (a network error, or
   after this branch review's retry logic in `FootballDataClient.get`, an
   exhausted-retries throw) never increments `requests`, and `finishRun`'s
   `requests_used` under-reports by exactly one in the case you most want an
   accurate count for: the failure that ended the run.

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
import type { RawStanding } from '@/lib/providers/types';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('backfill');
let requests = 0;
const squadSkips: string[] = [];

try {
  // Phase 1: leagues.
  console.log('1/7  seeding leagues');
  await upsertLeagues(LEAGUE_SEEDS.map((s) => ({
    fd_code: s.code, fd_id: s.fdId, slug: s.slug, name: s.name, country: s.country,
    emblem_url: `https://crests.football-data.org/${s.code}.png`,
    current_season: CURRENT_SEASON, season_start: null, season_end: null,
  })));
  const leagueIds = await getLeagueIdMap();

  // Phase 2: current clubs, straight from each competition's teams
  // endpoint — full metadata, never 403s for a club still in the
  // competition. See the rework note above for why this replaced
  // getSquad-per-club discovery.
  console.log('2/7  current clubs');
  const currentTeams: TeamRow[] = [];
  const seenFdIds = new Set<number>();
  for (const s of LEAGUE_SEEDS) {
    const teams = await fd.getCompetitionTeams(s.code); requests++;
    const leagueId = leagueIds.get(s.code)!;
    for (const team of teams) {
      currentTeams.push({
        fd_id: team.fdId, league_id: leagueId, slug: slugify(team.name), name: team.name,
        short_name: team.shortName, tla: team.tla, crest_url: team.crestUrl,
        venue: team.venue, founded: team.founded, club_colors: team.clubColors,
      });
      seenFdIds.add(team.fdId);
    }
    console.log(`     ${s.code}: ${teams.length} current clubs`);
  }
  await upsertTeams(currentTeams);

  // Phase 3: historical clubs, from last season's standings. Any club here
  // not already seen in phase 2 was relegated (or otherwise dropped) out of
  // every competition the free tier covers, so it can never be looked up by
  // id. Its identity comes from the standings row's embedded `team` object
  // — zero extra requests, no /teams/{id} call ever happens for it.
  // venue/founded/clubColors genuinely are not in that payload, so they
  // stay null rather than being invented.
  console.log('3/7  historical clubs (last season standings)');
  const historicalTeams: TeamRow[] = [];
  const standingsByLeague = new Map<string, RawStanding[]>();
  for (const s of LEAGUE_SEEDS) {
    const table = await fd.getStandings(s.code, PREVIOUS_SEASON); requests++;
    standingsByLeague.set(s.code, table);
    const leagueId = leagueIds.get(s.code)!;
    for (const row of table) {
      if (seenFdIds.has(row.teamFdId)) continue;
      historicalTeams.push({
        fd_id: row.teamFdId, league_id: leagueId, slug: slugify(row.teamName), name: row.teamName,
        short_name: row.teamShortName, tla: row.teamTla, crest_url: row.teamCrestUrl,
        venue: null, founded: null, club_colors: null,
      });
      seenFdIds.add(row.teamFdId);
    }
    console.log(`     ${s.code}: ${table.length} clubs in last season's table`);
  }
  await upsertTeams(historicalTeams);
  console.log(`     ${currentTeams.length} current + ${historicalTeams.length} historical-only clubs`);

  // Phase 4: resolve every club's database id ONCE, now that both current
  // and historical clubs have been written. Never inside a loop.
  console.log('4/7  resolving team ids');
  const teamIds = await getTeamIdMap();

  // Phase 5: squads for the current clubs only. A relegated club gets no
  // squad — correct, its identity alone is enough for the historical
  // standings table. A 403 on any individual club must not abort the run:
  // catch it, log which club was skipped, count it, and continue. Anything
  // that isn't a 403 (429, 500, ...) is a real failure and must still fail
  // loudly.
  console.log('5/7  squads (current clubs)');
  const collectedSquads: Array<{ teamFdId: number; squad: Awaited<ReturnType<typeof fd.getSquad>>['squad'] }> = [];
  for (const team of currentTeams) {
    try {
      const { squad } = await fd.getSquad(team.fd_id); requests++;
      collectedSquads.push({ teamFdId: team.fd_id, squad });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/football-data\.org 403 /.test(message)) {
        squadSkips.push(`${team.name} (fd_id ${team.fd_id})`);
        console.warn(`     skipped (403): ${team.name} (fd_id ${team.fd_id})`);
        continue;
      }
      throw err;
    }
  }

  await upsertPlayersByFdId(collectedSquads.flatMap(({ teamFdId, squad }) =>
    squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(teamFdId) ?? null,
      slug: `${slugify(p.name)}-${p.fdId}`, name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    }))));
  console.log(`     ${collectedSquads.length}/${currentTeams.length} squads fetched, ${collectedSquads.reduce((n, c) => n + c.squad.length, 0)} players, ${squadSkips.length} skipped (403)`);

  // Phase 6: fixtures for both seasons, both leagues. Fetched once each, not twice.
  console.log('6/7  fixtures');
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

  // Phase 7: last season's final tables, using the standings rows already
  // fetched in phase 3 — no re-fetch. With phase 3 in place every club here
  // now has a database row, so a lookup miss is a real bug, not an expected
  // gap: log it loudly by name rather than silently dropping the table row
  // (the original bug this replaced — `.filter((r) => r.team_id !==
  // undefined)` against `teamIds.get(...)!` — dropped rows for exactly the
  // relegated clubs that now resolve correctly, with no warning that a
  // league table had come up short).
  console.log('7/7  last season final tables');
  for (const s of LEAGUE_SEEDS) {
    const table = standingsByLeague.get(s.code)!;
    const leagueId = leagueIds.get(s.code)!;
    const rows = [];
    for (const r of table) {
      const teamId = teamIds.get(r.teamFdId);
      if (teamId === undefined) {
        console.warn(`     WARNING: unresolved club "${r.teamName}" (fd_id ${r.teamFdId}) in ${s.code} standings — row dropped`);
        continue;
      }
      rows.push({
        league_id: leagueId, team_id: teamId,
        season: PREVIOUS_SEASON, position: r.position, played: r.played, won: r.won,
        drawn: r.drawn, lost: r.lost, goals_for: r.goalsFor, goals_against: r.goalsAgainst,
        goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
      });
    }
    await upsertStandings(rows);
    console.log(`     ${s.code}: ${rows.length}/${table.length} standings rows written`);
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`\nBackfill complete. ${requests} requests used. ${squadSkips.length} squads skipped (403): ${squadSkips.join(', ') || 'none'}`);
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

Expected: roughly 113 requests (5 current-clubs + 5 historical-standings +
~98 squads + 10 fixtures, standings reuse phase 3's data with no extra
requests), taking about 12 minutes because the limiter paces to 10/min.
Final line reports the request count and the 403-skip count/list.

- [ ] **Step 4: Verify the data landed**

In the Supabase SQL Editor:

```sql
select 'leagues' t, count(*) from leagues
union all select 'teams', count(*) from teams
union all select 'players', count(*) from players
union all select 'fixtures', count(*) from fixtures
union all select 'standings', count(*) from standings;
```

Expected roughly: leagues 5, teams 105–120 (~98 current + relegated
clubs), players ~2000–2600, fixtures ~3600, standings ~98 (20 per league —
fewer means a historical club got dropped in phase 7, which now warns by
name instead of failing silently). Also check: zero fixtures with a null
`home_team_id`/`away_team_id`, zero teams with a null `crest_url`, and both
seasons (2025, 2026) present per league.

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

**Amended 2026-08-03, closing the La Liga/Serie A player gap surfaced by
Task 9's backfill:** `core.ts`'s scorer step originally assumed every scorer
it saw already had a `players` row from the backfill's squad phase — true
for PL/Bundesliga/Ligue 1, false for La Liga/Serie A, where `getSquad`
returns an empty squad for every club. Any scorer whose `playerFdId` was not
in `playerIds` silently produced zero stats rows (`flatMap` returning `[]`
for that entry) — not a crash, just a page that never gets built.

The fix, in `lib/ingest/scorerPlayers.ts` (`createMissingScorerPlayers` /
`newPlayersFromScorers`), runs between fetching `scorers` and writing
`player_season_stats`: it upserts a `players` row for every scorer id not
already in the map — `fd_id`, `name`, `position`, `nationality`,
`date_of_birth` straight off the scorer's own `player` object (Task 4's
`RawScorer` extension), `team_id` resolved via the existing team-id map,
`slug` as `${slugify(name)}-${fdId}` (identical convention to the backfill's
squad-based players, so a player later found in a real squad upserts onto
the same row instead of duplicating), `photo_url` always `null`. After the
upsert, `playerIds` is re-fetched (only when `newPlayers > 0`, to avoid an
unnecessary DB round trip) so the very same run's stats write resolves the
players it just created, rather than needing a second invocation.

The identical helper is reused, unchanged, by
`scripts/ingest/seedScorerPlayers.ts` for the previous season (2025) — see
Task 9's follow-up note for why that is a separate dedicated script rather
than a new backfill phase. `core.ts`'s own scorer step processes the
current season (2026) with this same fix in place; it created 0 players on
its first live re-run simply because season 2026 has 0 scorers everywhere
(no matches played yet), not because the fix is inert — `seedScorerPlayers.ts`
against season 2025 is what actually exercises it (96 new La Liga players,
97 new Serie A players, live-verified).

**Amended 2026-08-03, post-branch-review — the matchday 429 cascade and its
downstream fixes:** the whole-branch review traced a concrete failure mode:
`core.ts` issues 3 requests × 5 leagues = 15 in its first ~20 seconds;
`live.ts` (below, pre-fix) issued 5 requests per poll × 4 polls = 20 per run,
every 5 minutes. Both hit the *same* `FOOTBALL_DATA_KEY` and its 10 req/min
ceiling, and until Task 11's concurrency fix the two workflows could run in
the same provider minute — 10 (core) + 5 (one live poll) = 15 against a
10/min ceiling, and `FootballDataClient.get` (pre-fix, Task 4) threw on the
first 429 with no retry. Result: red runs roughly every matchday hour,
silently stalling standings/scorers during the exact hours people are
watching. Three code changes below are corrections to what's shown further
down in this task:

1. **`core.ts`'s standings write no longer drops rows silently.** The
   snippet below does `team_id: teamIds.get(r.teamFdId)!` followed by
   `.filter(r => r.team_id !== undefined)` — the non-null assertion (`!`)
   lies to the type checker (the map genuinely can produce `undefined` in
   practice) and makes that filter read like dead code, so a club with no
   `teams` row yet silently produced a short table with `status='ok'` and
   nothing in the logs. `backfill.ts` phase 7 already handles the identical
   case correctly (resolve explicitly, `console.warn` the club name and
   `fd_id`, drop the row) — `core.ts` now matches that pattern exactly. Do
   not "simplify" this back to the `!` + filter shape; that reintroduces the
   silent drop.
2. **`requests++` moved before its paired `await fd.xxx(...)` call**, same
   reasoning as Task 9's amendment: counting after the call means a call
   that itself throws is never counted, under-reporting `requests_used`
   in exactly the failure case you'd want it most.
3. **`live.ts` is substantially rewritten** — see the amendment right before
   its own code block, further down this task. Do not implement the
   `getMatches` × per-league × per-poll shape shown in the snippet below;
   that is the 20-requests-per-run cost this fix removes.

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

> **SUPERSEDED 2026-08-03 (post-branch-review, player-identity pass):** the
> snippet below always inserts a new row for every FPL player
> (`upsertPlayersByFplId(...)` with `team_id: null`, no attempt to find an
> existing row). That is the root of the two-disjoint-rows bug: football-data
> and FPL each independently write a `players` row for the same Premier
> League human being — football-data via `fd_id` (full squad + club, no
> photo), FPL via `fpl_id` (deep stats + photo, no club of its own) — and
> `onConflict: 'fpl_id'` can never match the football-data row because its
> `fpl_id` is `NULL`, and Postgres treats `NULL` as distinct from every other
> `NULL` in a unique index. Confirmed live against the project's own
> database before the fix: 2,448 `players` rows, only 1,881 with a `team_id`
> — the other 567 were the *entire* Premier League roster, present only via
> `fpl_id`, floating with no club, no photo displayed anywhere a squad page
> would query by `team_id`, and appearing a second time in name search
> alongside their football-data twin (`players_name_trgm`).
>
> **The fix**, in `lib/ingest/playerIdentity.ts` (new), applied by the actual
> `scripts/ingest/players.ts`:
> 1. `matchFplTeamsToClubs` resolves each of FPL's 20 club ids onto this
>    project's own `teams` rows for the Premier League, by normalised name
>    plus a short-code fallback (football-data's `tla` vs FPL's
>    `shortName` — the two providers don't share a full-name convention at
>    all: FPL's `name` field is itself an informal nickname, e.g. "Spurs",
>    "Man Utd", not "Tottenham Hotspur FC"/"Manchester United FC"). Verified
>    live against this project's actual Premier League clubs: **19/20
>    matched**; Nottingham Forest is the one honest miss (football-data's TLA
>    `NOT` vs FPL's short name `NFO` — a genuine disagreement between the two
>    providers' own codes, not a bug in the matcher).
> 2. `matchPlayersTiered` (`lib/ingest/playerMatch.ts`) matches each FPL
>    player onto an *existing* football-data player, scoped to its club, via
>    a three-tier match — exact normalised full name, then FPL's `web_name`
>    against the last token of a candidate's name, then `web_name` against
>    any whole token — each tier only accepted if it narrows the within-club
>    candidate pool to exactly one player. This superseded an earlier plain
>    global exact-full-name join (`matchFplPlayersByName`, since removed)
>    that only reached 253 of ~620 Premier League FPL players, because FPL's
>    name is the player's full *legal* name while football-data stores the
>    *display* name ("David Raya Martín" vs "David Raya"). Still not fuzzy
>    matching, an alias table, or manual overrides — see that module's doc
>    comment for the full reasoning and `.superpowers/sdd/final-fixes-b-report.md`
>    for the exact tier-by-tier counts. A match updates that row's
>    `fpl_id`/`photo_url` in place, leaving `fd_id`, `team_id` and `slug`
>    untouched. A miss still inserts a new row (no FPL player is silently
>    dropped), but now with `team_id` resolved from step 1 instead of always
>    `null`.
> 3. `player_season_stats` is written exactly as before, but the id lookup
>    (`getPlayerIdByFplId`) now resolves correctly for both matched and
>    newly-inserted players, since both carry `fpl_id` by the time it runs.
>
> Read `scripts/ingest/players.ts` directly for the real implementation; the
> snippet below is retained only as a historical record of what this task
> originally shipped (and the bug it contained) and must not be
> reintroduced.
>
> **Repairing the 567 rows this bug already wrote in production:** a
> one-shot script, `scripts/repair/mergeFplPlayers.ts` (same pattern as
> `seedScorerPlayers.ts` — run once by hand, not on a schedule), applies the
> same tiered matcher to the orphan rows already sitting in the database,
> re-joining each orphan against the live `bootstrap-static` payload by
> `fpl_id` to recover the `web_name` and club the stored row alone doesn't
> carry: a matched orphan has its `player_season_stats` rows repointed onto
> the football-data row's id (must happen *before* the orphan is deleted —
> `player_season_stats.player_id` is a foreign key `on delete cascade`) and
> is then deleted; an orphan with no football-data match gets `team_id` set
> from the FPL team mapping instead, so it at least stops being teamless.
> Run for real against the project's live database — see the Definition of
> Done below for the observed before/after numbers.

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

> **SUPERSEDED 2026-08-03 (post-branch-review):** the snippet below calls
> `fd.getMatches(s.code, CURRENT_SEASON)` — a full-season fetch (~380
> fixtures) — once per league per poll: 5 requests/poll × 4 polls = 20
> requests per run, every 5 minutes during a match window. That is the
> other half of the matchday 429 cascade (see Task 10's amendment above
> core.ts). **Before changing this, the whole-branch-review fix verified
> live, against the free-tier key, that `GET /v4/matches` accepts a
> comma-separated `competitions` filter plus a `dateFrom`/`dateTo` window and
> returns matches for all five leagues in one call** — confirmed 2026-08-03:
> `?competitions=PL,PD,SA,BL1,FL1&dateFrom=2026-08-14&dateTo=2026-08-21`
> returned `200`, 28 matches tagged across `PD`/`FL1`/`PL`/`SA` via each
> match's own `competition.code` (the fifth, `BL1`, simply had no fixtures in
> that particular window — not a sign the filter dropped it). Also confirmed:
> the provider caps the date span at 10 days (`400 "Specified period must
> not exceed 10 days."` on a wider probe), so any window passed to this
> endpoint must stay at or under that.
>
> The actual `live.ts` now calls the new
> `FootballDataClient.getMatchesAcrossLeagues(codes, dateFrom, dateTo, season)`
> (Task 4's amendment) once per poll with a ±1 day window — comfortably
> within the 10-day cap and generous enough for anything `isLiveRelevant`
> cares about (in-play, or finished within `LIVE_RELEVANCE_TRAIL_MINUTES`) —
> taking the job from 20 requests/run down to **4** (one per poll). Each
> match's league is resolved from its own `leagueCode` (set by
> `getMatchesAcrossLeagues` from the response's `competition.code`, not
> assumed from a per-league loop), and `leagueIds.get(m.leagueCode)` is
> checked explicitly with a thrown error message
> (`` `league ${m.leagueCode} missing — run backfill first` ``) rather than
> the `leagueIds.get(s.code)!` non-null assertion shown below — the same
> inconsistency Task 10's `core.ts` already avoided by throwing a clear
> message instead of letting a bad assertion surface as an opaque Postgres
> not-null violation. Do not reintroduce the per-league loop shown next; it
> is the exact shape this fix removes.

```ts
import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { isMatchWindowOpen, isLiveRelevant } from '@/lib/ingest/matchWindow';
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
const nowIso = () => new Date().toISOString();
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

  const now = new Date();
  for (let poll = 0; poll < POLLS; poll++) {
    for (const s of LEAGUE_SEEDS) {
      const matches = await fd.getMatches(s.code, CURRENT_SEASON); requests++;
      const active = matches.filter((m) => isLiveRelevant(m, now));
      if (active.length === 0) continue;
      await upsertFixtures(active.map((m) => ({
        fd_id: m.fdId, league_id: leagueIds.get(s.code)!,
        home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
        away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
        season: CURRENT_SEASON, kickoff_utc: m.kickoffUtc, status: m.status,
        matchday: m.matchday, home_goals: m.homeGoals, away_goals: m.awayGoals,
        half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
        last_updated: m.lastUpdated, updated_at: nowIso(),
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

**Amended 2026-08-03, post-branch-review — shared concurrency group is the
headline fix for the matchday 429 cascade (see Task 10's amendment):** the
five ingest workflows below each got their own `concurrency.group`
(`ingest-core`, `ingest-live`, `ingest-squads`, plus news/players), which
meant GitHub Actions could run `ingest-core` and `ingest-live` at the same
wall-clock time — the two workflows that shared `FOOTBALL_DATA_KEY` and its
10 req/min ceiling could then both be mid-run in the same provider minute.

**`ingest-core.yml`, `ingest-live.yml` and `ingest-squads.yml` now all use
the identical `concurrency.group: football-data-api`** (with
`cancel-in-progress: false` preserved, so a run that would have collided
queues and still executes rather than being dropped) — this serializes every
workflow that touches football-data.org, so at most one of them is ever
mid-request against the shared key at a time. **`ingest-news.yml` and
`ingest-players.yml` keep their own groups unchanged** — they call FPL and
RSS respectively, neither of which is metered or touches
`FOOTBALL_DATA_KEY`, so there is nothing for them to serialize against. Each
of the three shared-group workflow files now carries a comment explaining
why the group is shared, specifically so a future cleanup pass doesn't
"tidy" them back apart into per-workflow groups — that would silently
reopen the cascade this fix closes.

Also fixed in the same pass, in every workflow's `env:` block below:
**`SUPABASE_ANON_KEY` is removed.** No code path ever reads it —
`lib/db/client.ts`'s `serviceClient()` only ever uses
`SUPABASE_SERVICE_ROLE_KEY` — and Task 1's `loadEnv` schema now marks
`SUPABASE_ANON_KEY` optional specifically so a workflow holding only the
service-role key still loads successfully. The variable is still documented
(here, and in `lib/config/env.ts`'s schema) for Phase B, which is expected to
need it client-side; only the unused workflow wiring and the required-ness
in the schema are removed.

- [ ] **Step 2: Write a reusable ingest workflow — `.github/workflows/ingest-core.yml`**

```yaml
name: ingest-core
on:
  schedule: [{ cron: '0 * * * *' }]
  workflow_dispatch:
# Shared with ingest-live and ingest-squads — see the amendment above.
# Do NOT split this back into its own `ingest-core` group.
concurrency:
  group: football-data-api
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
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

(`concurrency.group: ingest-news` is unchanged by the 2026-08-03 amendment
above — RSS is unmetered, so this workflow has nothing to serialize against.
Only the unused `SUPABASE_ANON_KEY` line is removed.)

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
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

(`concurrency.group: ingest-players` is unchanged — FPL is unmetered. Only
the unused `SUPABASE_ANON_KEY` line is removed.)

- [ ] **Step 5: Write `.github/workflows/ingest-live.yml`**

```yaml
name: ingest-live
on:
  schedule: [{ cron: '*/5 * * * *' }]
  workflow_dispatch:
# Shared with ingest-core and ingest-squads — see Task 11's amendment above
# ingest-core.yml. Do NOT split this back into its own `ingest-live` group.
concurrency:
  group: football-data-api
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

> **SUPERSEDED 2026-08-03 (post-branch-review), and already stale before
> this pass:** the snippet below discovers clubs via a plain
> `serviceClient().from('teams').select('fd_id')` — that was already replaced
> during the backfill rework (see Task 4's `getCompetitionTeams` note) with
> `fd.getCompetitionTeams(s.code)` per league, for the same reason the
> backfill uses it: a plain `teams` select can't distinguish a current club
> from a historical one, and a relegated club would otherwise get queued for
> a pointless (and 403-guaranteed) squad fetch. The actual `scripts/ingest/squads.ts`
> was already on `getCompetitionTeams` + a `Set<fdId>` before this review;
> **this branch-review pass adds one more fix on top of that:**
>
> `getCompetitionTeams` returns full `RawTeam` records (crest, shortName,
> tla, venue, founded, clubColors) but the pre-fix code kept only `.fdId` for
> the `Set` and threw the rest away. Consequence: crest changes and renames
> never reached `teams`, and — critically — **any club newly promoted into a
> covered competition never got a `teams` row at all**, because nothing else
> in the weekly schedule writes one. `core.ts`'s next run would then resolve
> that club's fixtures with `home_team_id: null`. Fix: `squads.ts` now calls
> `upsertTeams(currentTeams)` on the full `getCompetitionTeams` result
> *before* the squad-fetching loop — zero extra requests, since the fetch
> already happened for club discovery. Team slugs written here use
> `slugWithFdId` (`lib/db/slug.ts`), matching the same fix in `backfill.ts`
> (see Task 9's amendment) — not the plain `slugify(team.name)` this file
> never actually had a code path for team slugs before (it only wrote player
> slugs). `requests++` was also moved before its paired `await fd.getSquad(...)`
> call, same reasoning as Tasks 9 and 10's amendments.
>
> Read `scripts/ingest/squads.ts` directly; the snippet below is retained
> only as a historical record of Task 12's original shape and should not be
> used as an implementation reference.

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
# Shared with ingest-core and ingest-live — see Task 11's amendment above
# ingest-core.yml. Do NOT split this back into its own `ingest-squads` group.
concurrency:
  group: football-data-api
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
- [ ] **(Added 2026-08-03) `ingest-core.yml`, `ingest-live.yml` and `ingest-squads.yml` share `concurrency.group: football-data-api`** — verify in the Actions tab that a manual dispatch of one queues rather than runs concurrently with another
- [ ] **(Added 2026-08-03) `FootballDataClient.get` retries 429/5xx with backoff** (`tests/providers/footballData.test.ts`, describe block `FootballDataClient retry with backoff`) and does not retry other 4xx (403 still fails on the first attempt)
- [ ] **(Added 2026-08-03) `live.ts` uses `getMatchesAcrossLeagues` and costs 4 requests/run, not 20**
- [ ] **(Added 2026-08-03) `squads.ts` writes full team metadata via `upsertTeams`, not just a discarded `Set<fdId>`**
- [ ] **(Added 2026-08-03) `0003_lock_down_ingest_observability.sql` applied by the project owner** (not automated — see Task 2's amendment)
- [x] **(Added 2026-08-03, player-identity/data-honesty pass) Premier League players resolve to a single row.** `scripts/ingest/players.ts` matches FPL identity onto existing football-data rows (`lib/ingest/playerIdentity.ts` for the club match, `lib/ingest/playerMatch.ts` for the tiered player match) instead of inserting a parallel row; `scripts/repair/mergeFplPlayers.ts` repaired the 567 rows the old code had already written — see `.superpowers/sdd/final-fixes-b-report.md` for the exact before/after numbers, FPL-team match rate (19/20; Nottingham Forest's TLA/short-name disagreement is the one honest miss), and per-tier player name-match counts.
- [x] **(Added 2026-08-04, tiered-match pass) Player match rate improved by scoping to club and adding `web_name` tiers.** The original exact-full-name join reached only 253/~620 Premier League FPL players, because FPL's name is the full legal name while football-data stores the display name. `matchPlayersTiered` (`lib/ingest/playerMatch.ts`, unit-tested in `tests/ingest/playerMatch.test.ts`) tries exact match, then `web_name` against a candidate's last name-token, then `web_name` against any whole token — each scoped to the FPL player's own club and only accepted if it narrows the candidate pool to exactly one player, never guessing at an ambiguous tier. Run for real against the live database: orphans went from 124 to 5 (all Nottingham Forest, the one club-level miss above), `players` rows with both `fd_id` and `fpl_id` went from 253 to 313. See `.superpowers/sdd/final-fixes-b-report.md` for the full before/after and the residual list (including two honest same-club ambiguities and two cross-league same-name pairs deliberately left unmerged).
- [x] **(Added 2026-08-03) `lib/providers/fpl.ts` no longer fabricates `minutes`/`goals`/`assists`/`position`.** All four are `?? null`, not `?? 0` / `?? 'Unknown'`; a real reported `0` still survives as `0` (pinned regression tests in `tests/providers/fpl.test.ts`, mirroring the existing `expectedGoals` test). Elements whose `element_type` isn't a known playing position (e.g. a fantasy manager, type 5) are skipped rather than stored.
- [x] **(Added 2026-08-03) `news_items.published_at` is no longer fabricated.** `safePublishedAt` returns `null`, not `new Date().toISOString()`, for an absent/unparseable date; `supabase/migrations/0004_nullable_news_published_at.sql` makes the column nullable (not yet applied — same by-hand process as `0003`); `lib/db/repositories/news.ts` tolerates both migration states (skips the undated item without crashing the batch until applied, stores `null` once it is).
- [ ] **(Added 2026-08-03) `0004_nullable_news_published_at.sql` applied by the project owner** (not automated — see Task 2's amendment; must be applied after `0003`)

---

## Next

Phase B (the site) is a separate plan: `docs/superpowers/plans/2026-08-XX-phase-b-site.md`. It reads exclusively from the tables this phase populates and adds no provider dependencies.

**Open item carried forward:** live-score latency is unmeasurable until 2026-08-16 (La Liga's first matchday). On that date, compare `fixtures.last_updated` against real kickoff events and record the observed delay in spec §2.4.

**Also carried forward from the 2026-08-03 branch review (that pass fixed the
pipeline-correctness half; this pass — player identity and data honesty — is
now done, see `.superpowers/sdd/final-fixes-b-report.md` for full numbers):**
- Apply `supabase/migrations/0003_lock_down_ingest_observability.sql` by hand
  (Supabase dashboard SQL Editor, or the CLI with real credentials) — this
  agent cannot apply it.
- Apply `supabase/migrations/0004_nullable_news_published_at.sql` the same
  way, **after** `0003` — this agent cannot apply it either. Until it's
  applied, an RSS item with an unusable date is skipped (not stored, not
  guessed at) rather than crashing the news job; see `lib/db/repositories/
  news.ts`.
- On or after 2026-08-16, once real matchday traffic exists, confirm in
  practice that the shared `football-data-api` concurrency group plus the
  new retry logic actually eliminates the 429 cascade this pass fixed on
  paper (verified via code review, the retry unit tests, and a live probe of
  `getMatchesAcrossLeagues` — not yet observed against genuine concurrent
  matchday load, since preseason has no in-play matches to trigger it).
- Player-identity matching is a tiered, club-scoped exact/last-token/
  whole-token match, deliberately not fuzzy matching, an alias table, or
  manual overrides (see `lib/ingest/playerIdentity.ts` for the club match
  and `lib/ingest/playerMatch.ts` for the tiered player match). Nottingham
  Forest's FPL team never matches (football-data's `tla` `NOT` vs FPL's
  `short_name` `NFO` genuinely disagree), which is why all 5 remaining
  fully-orphaned players are Nottingham Forest signings — a real minority of
  Premier League players still won't match at all (an honest same-club
  token ambiguity, e.g. two players both named "Gabriel ___"; a multi-token
  `web_name` the tiers don't cover) and a few cross-league same-name pairs
  exist in the full `players` table that were deliberately not merged (see
  the report for the observed rate and every example). Phase B's squad/
  player pages must independently check for `team_id` and for `fpl_id`/
  `fd_id` presence rather than assume every Premier League player has both a
  club and full FPL statistics, and must not assume a name search returns
  exactly one row.
