# Touchline Phase B1 — Foundation and Matchday Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js site, in the "Broadcast" dark visual direction, that renders live scores, a fixture calendar and a landing page from the Phase A database — working correctly on the season opener, 2026-08-16.

**Architecture:** Next.js 15 App Router. Every page is a server component reading Postgres through a typed query layer; no third-party API is ever on a request path. Per-route revalidation keeps pages fresh, and live views additionally poll a lightweight JSON route handler that patches only changed values in place, preserving scroll position and filters.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, `@supabase/supabase-js`, Vitest, Playwright, Netlify.

> **Why Next 16, not 15:** this repo pins TypeScript 7.0.2, which removed the classic compiler API that Next 15's `next.config.ts` loader depends on. Next 15 fails to build here and its own error recommends Next ≥16.2.11 or TypeScript 6. Upgrading Next is correct; downgrading the locked TypeScript would disturb the working Phase A toolchain.

## Global Constraints

- **No paid services, ever.** Everything sits in a permanent free tier.
- **Reads use the `anon` Supabase key, which is SELECT-only** and enforced by RLS. The site never writes. The service-role key must never appear in client-reachable code.
- **No provider API is ever called on a page request path.** Pages read Postgres only.
- **Never invent data.** A `null` renders as an explicit "not available", never as `0`, `-`, or a guess. This is a product promise.
- **Every image has a monogram fallback.** A missing crest or photo must never render as a broken icon.
- **No generated imagery anywhere.** Real crests from `crests.football-data.org`, real photos from `resources.premierleague.com`.
- **Refreshing a page must refresh that page's data and preserve the user's place** — real URLs, server-rendered, filters in the query string.
- Dark-first, with a genuinely built light theme. All text meets WCAG AA. Live state is never signalled by colour alone.
- **Tabular numerals on every score and statistic** so digits don't jitter as values update.
- Netlify's free tier is credit-based: **300 credits/month, 15 per production deploy** (~20 deploys). Verify locally; deploy in batches.
- Node 24, ESM, TypeScript strict with `noUncheckedIndexedAccess`.
- League codes are exactly `PL`, `PD`, `SA`, `BL1`, `FL1`. Current season `2026`, previous `2025`.

## Data reality this plan must design for

Verified against the live database on 2026-08-04:

| Fact | Consequence for the UI |
|---|---|
| Season 2026: 1,707 SCHEDULED, 45 TIMED, **0 FINISHED** | Every score view needs a real preseason state, not an empty list |
| Only **6 fixtures in the next 14 days** | The landing page is in countdown mode until 2026-08-16 |
| `standings` has 96 rows for 2026, all zeros at matchday 1 | League tables render structure, not nothing |
| 2025 season complete: 1,752 fixtures, 96 final table rows | Real content exists for "last season" views |
| Players: PL 677, **La Liga 96, Serie A 97**, Bundesliga 572, Ligue 1 498 | La Liga and Serie A have only top scorers, never full squads |
| 377 of 1,945 players have a photo (FPL only) | Monogram fallback is the *normal* case, not an error state |
| `news_items.league_id` and `team_ids` are **0 of 150 populated** | News cannot be filtered by club or league — deferred to Plan B2 |

---

## File Structure

```
app/
  layout.tsx                    Root shell: fonts, theme bootstrap, header, footer
  globals.css                   Tailwind v4 import + design tokens (both themes)
  page.tsx                      Landing
  scores/page.tsx               Live and recent scores
  calendar/page.tsx             Month/week fixture calendar
  api/live/route.ts             JSON for client-side score patching
  api/calendar.ics/route.ts     iCalendar export
lib/site/
  supabase.ts                   Read-only browser-safe client (anon key)
  rows.ts                       Row types mirroring the database
  queries/fixtures.ts           getLiveAndRecent, getUpcoming, getFixturesInRange
  queries/leagues.ts            getLeagues, getSeasonStarts
  queries/news.ts               getTrendingNews
  format.ts                     Kickoff formatting, relative time, data-age
  monogram.ts                   Deterministic initials + colour from a club name
components/
  Crest.tsx                     Club crest with monogram fallback
  ScoreRow.tsx                  One fixture line, tabular numerals
  DataAge.tsx                   "updated N minutes ago"
  LeagueFilter.tsx              Query-string-driven league filter
  ThemeToggle.tsx               data-theme switch, persisted
  LiveScores.tsx                Client island: polls /api/live, patches in place
tests/site/
  format.test.ts  monogram.test.ts  queries.test.ts
e2e/
  smoke.spec.ts                 Playwright: render, refresh, live patch
netlify.toml
```

---

### Task 1: Next.js scaffold, design tokens and both themes

**Files:**
- Create: `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `postcss.config.mjs`
- Modify: `package.json`, `tsconfig.json`
- Test: none — this task's deliverable is a clean `npm run build`; E2E lands in Task 9

**Interfaces:**
- Consumes: nothing.
- Produces: a running dev server; CSS custom properties `--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--live` resolved for both themes; `RootLayout`.

- [ ] **Step 1: Install**

```bash
cd /Users/kinshukkhandelwal/Desktop/Claude/football-app
npm i next@16 react@19 react-dom@19
npm i -D @tailwindcss/postcss tailwindcss@4 @types/react @types/react-dom
npm pkg set scripts.dev="next dev"
npm pkg set scripts.build="next build"
npm pkg set scripts.start="next start"
```

- [ ] **Step 2: Write `postcss.config.mjs`**

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

- [ ] **Step 3: Write `next.config.ts`**

Only these two hosts serve our imagery; whitelisting anything else would let a bad data row point `next/image` at an arbitrary origin.

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'crests.football-data.org' },
      { protocol: 'https', hostname: 'resources.premierleague.com' },
    ],
  },
};

export default config;
```

- [ ] **Step 4: Write `app/globals.css`**

Dark is the primary design. Light is a considered translation, not an inversion: the accent lime is unreadable as text on white, so light mode uses a darker green for text-weight accent while keeping lime for fills.

```css
@import "tailwindcss";

:root {
  --bg:      #0B0E11;
  --surface: #14181D;
  --border:  #232A31;
  --text:    #E8EDF2;
  --muted:   #8A94A0;
  --accent:  #C8FF00;
  --accent-ink: #0B0E11;   /* text placed ON the accent */
  --live:    #FF3B47;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg:      #FBFAF8;
    --surface: #FFFFFF;
    --border:  #E4E0D8;
    --text:    #14181D;
    --muted:   #5F6772;
    --accent:  #3F6B00;
    --accent-ink: #FFFFFF;
    --live:    #C0392B;
  }
}

:root[data-theme="light"] {
  --bg:      #FBFAF8;
  --surface: #FFFFFF;
  --border:  #E4E0D8;
  --text:    #14181D;
  --muted:   #5F6772;
  --accent:  #3F6B00;
  --accent-ink: #FFFFFF;
  --live:    #C0392B;
}

:root[data-theme="dark"] {
  --bg:      #0B0E11;
  --surface: #14181D;
  --border:  #232A31;
  --text:    #E8EDF2;
  --muted:   #8A94A0;
  --accent:  #C8FF00;
  --accent-ink: #0B0E11;
  --live:    #FF3B47;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-text: var(--text);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-live: var(--live);
}

html { color-scheme: dark light; }
body {
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

/* Visible focus for every interactive element, both themes. */
:where(a, button, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 5: Write `app/layout.tsx`**

The inline script runs before paint so a user who chose light mode never sees a dark flash.

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Touchline — Europe\'s top five leagues',
  description: 'Live scores, fixtures, tables and news for the Premier League, La Liga, Serie A, Bundesliga and Ligue 1.',
};

const themeBootstrap = `
try {
  var t = localStorage.getItem('touchline-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Write a placeholder `app/page.tsx`**

```tsx
export default function Home() {
  return <main className="p-8"><h1 className="text-2xl font-bold">Touchline</h1></main>;
}
```

- [ ] **Step 7: Exclude Next build output and app dirs from the Vitest run**

Modify `vitest.config.ts` so the site's E2E specs never run under Vitest:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
```

- [ ] **Step 8: Add Next build artefacts to `.gitignore`**

Append to `.gitignore`:

```
.next/
next-env.d.ts
```

- [ ] **Step 8a: Fix `tsconfig.json` to include `app/**/*` and `components/**/*`**

Add these two entries to the `include` array in `tsconfig.json` so TypeScript checks `app/` files directly instead of relying on `.next/` types generated during build. `components/` does not exist yet (Task 4 creates it), but the glob is added now to prevent the same gap reappearing when it does. TypeScript tolerates an empty glob.

Reason: CI runs `npm ci` → `npm run typecheck` → `npm test` with no build step, so without direct includes, every file under `app/` was silently untypechecked in CI (checked only as a transitive side effect if `.next/` happened to exist).

- [ ] **Step 8b: Fix `.github/workflows/ci.yml` to run `npm run build` before typecheck**

Add a `- run: npm run build` step **after** `npm ci` and **before** `npm run typecheck` so CI exercises the real Next build and generates route types Next itself validates. Keep the workflow referencing no secrets — that property is what guarantees CI never makes a live provider call.

Reason: Same as above — without the build step, CI's typecheck was a no-op for `app/` files.

- [ ] **Step 9: Verify it builds and the existing suite still passes**

```bash
npm run build
npm test
npm run typecheck
```

Expected: build succeeds; 157 tests pass, 8 skipped.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Next.js scaffold with Broadcast design tokens and both themes"
```

---

### Task 2: Read-only data layer

**Files:**
- Create: `lib/site/supabase.ts`, `lib/site/rows.ts`, `lib/site/queries/leagues.ts`, `lib/site/queries/fixtures.ts`, `lib/site/queries/news.ts`
- Modify: `lib/config/env.ts`
- Test: `tests/site/queries.test.ts`

**Interfaces:**
- Consumes: `loadEnv` from `lib/config/env.ts`.
- Produces:
  - `readClient(): SupabaseClient`
  - Types `LeagueRow`, `TeamLite`, `FixtureWithTeams`, `NewsRow`
  - `getLeagues(): Promise<LeagueRow[]>`
  - `getLiveAndRecent(now: Date): Promise<FixtureWithTeams[]>`
  - `getUpcoming(now: Date, limit?: number): Promise<FixtureWithTeams[]>`
  - `getFixturesInRange(fromIso: string, toIso: string, leagueIds?: number[]): Promise<FixtureWithTeams[]>`
  - `getTrendingNews(limit?: number): Promise<NewsRow[]>`

- [ ] **Step 1: Make the anon key required again for the site**

`lib/config/env.ts` made `SUPABASE_ANON_KEY` optional in Phase A because ingestion never used it. The site does. Change that field to:

```ts
  SUPABASE_ANON_KEY: z.string().min(20),
```

and add a comment noting the site reads with it while ingestion writes with the service key.

**This breaks an existing test.** `tests/config/env.test.ts` currently asserts the anon key is *optional*; that assertion now states the opposite of the requirement and must be updated to assert it is required. Update it as part of this step.

- [ ] **Step 2: Write `lib/site/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '@/lib/config/env';

let cached: SupabaseClient | null = null;

/**
 * Read-only client for the public site. The anon key is SELECT-only, enforced
 * by grants AND row-level security, so this cannot write even if asked to.
 * Never import the service-role client into anything the site renders.
 */
export function readClient(): SupabaseClient {
  if (cached) return cached;
  const env = loadEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 3: Write `lib/site/rows.ts`**

```ts
export interface LeagueRow {
  id: number;
  fd_code: string;
  slug: string;
  name: string;
  country: string;
  emblem_url: string | null;
  current_season: number;
}

export interface TeamLite {
  id: number;
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
}

export interface FixtureWithTeams {
  id: number;
  league_id: number;
  season: number;
  kickoff_utc: string;
  status: string;
  matchday: number | null;
  home_goals: number | null;
  away_goals: number | null;
  updated_at: string;
  home: TeamLite | null;
  away: TeamLite | null;
}

export interface NewsRow {
  id: number;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  categories: string[];
}
```

- [ ] **Step 4: Write the failing test**

Create `tests/site/queries.test.ts`. The `buildFixtureSelect` tests verify query *shape*
without a database. **`getLiveAndRecent` must be tested as a decision rule, not as a
constant's shape** — an earlier version of this step asserted `LIVE_STATUSES` merely
`toContain('IN_PLAY')`, which passed even though the query never used the constant at
all (a pure kickoff-time window, no status filter). That shipped a real bug: a
`POSTPONED`/`CANCELLED`/`SUSPENDED` fixture kicking off in the past 6h was shown as
live (false positive), and an `IN_PLAY` fixture resumed after a long suspension more
than 6h after kickoff silently disappeared (false negative). Test the pure predicate
`isLiveOrRecent(status, kickoffUtc, now)` instead, so the rule itself is pinned:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixtureSelect, isLiveOrRecent, RECENT_WINDOW_HOURS } from '@/lib/site/queries/fixtures';

describe('fixture select', () => {
  it('joins both teams so a crest never needs a second query', () => {
    const sel = buildFixtureSelect();
    expect(sel).toContain('home:home_team_id');
    expect(sel).toContain('away:away_team_id');
    expect(sel).toContain('crest_url');
    expect(sel).toContain('slug');
  });

  it('requests updated_at so pages can show data age honestly', () => {
    expect(buildFixtureSelect()).toContain('updated_at');
  });
});

describe('isLiveOrRecent', () => {
  const now = new Date('2026-08-04T18:00:00Z');
  // ... IN_PLAY/PAUSED always true regardless of elapsed time (including 9h after
  // kickoff — a resumed suspension); FINISHED/AWARDED true only inside the recent
  // window, false 3 days later; POSTPONED/CANCELLED/SUSPENDED always false even with
  // a kickoff 1h ago; SCHEDULED/TIMED in the future always false. See
  // tests/site/queries.test.ts for the full table, including the RECENT_WINDOW_HOURS
  // sanity check.
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npm test -- tests/site/queries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/site/queries/fixtures'`

- [ ] **Step 6: Write `lib/site/queries/fixtures.ts`**

**Do not implement `getLiveAndRecent` as a pure kickoff-time window.** An earlier
version of this step did exactly that — `.gte('kickoff_utc', ...).lte('kickoff_utc',
now)` with no status filter — while its own doc comment claimed it returned "anything
in play, plus anything that finished recently enough to still matter." It returned
neither correctly: a `SUSPENDED` fixture is not "in play" for display purposes (unlike
`lib/ingest/matchWindow.ts`'s ingestion guard, which deliberately keeps polling a
`SUSPENDED` fixture because it might resume — that is "should we fetch," this is
"should we display," and they answer differently on purpose), and an `IN_PLAY` fixture
outside the window would wrongly disappear. Make the query genuinely status-aware,
built from the same status sets the `isLiveOrRecent` predicate uses, so the two can
never drift apart:

```ts
import { readClient } from '@/lib/site/supabase';
import type { FixtureWithTeams } from '@/lib/site/rows';

// IN_PLAY/PAUSED are always shown, regardless of kickoff time.
export const LIVE_STATUSES = ['IN_PLAY', 'PAUSED'] as const;
// FINISHED/AWARDED are shown only inside the recent window.
export const RECENT_FINISHED_STATUSES = ['FINISHED', 'AWARDED'] as const;
// POSTPONED/CANCELLED/SUSPENDED are absent from both sets above and therefore never
// shown, whatever their kickoff time — see the comment on isLiveOrRecent for why this
// is the deliberate opposite of matchWindow.ts's SUSPENDED handling.
export const RECENT_WINDOW_HOURS = 6;

const TEAM_FIELDS = 'id,slug,name,short_name,tla,crest_url';

/** One select, both teams joined — a crest must never cost a second query. */
export function buildFixtureSelect(): string {
  return [
    'id', 'league_id', 'season', 'kickoff_utc', 'status', 'matchday',
    'home_goals', 'away_goals', 'updated_at',
    `home:home_team_id(${TEAM_FIELDS})`,
    `away:away_team_id(${TEAM_FIELDS})`,
  ].join(',');
}

function hoursAgo(now: Date, h: number): string {
  return new Date(now.getTime() - h * 3600_000).toISOString();
}

/** The decision rule behind getLiveAndRecent, pure and DB-free so it is unit-testable. */
export function isLiveOrRecent(status: string, kickoffUtc: string, now: Date): boolean {
  if ((LIVE_STATUSES as readonly string[]).includes(status)) return true;
  if ((RECENT_FINISHED_STATUSES as readonly string[]).includes(status)) {
    const kickoffTime = new Date(kickoffUtc).getTime();
    const nowTime = now.getTime();
    return kickoffTime >= nowTime - RECENT_WINDOW_HOURS * 3600_000 && kickoffTime <= nowTime;
  }
  return false; // SCHEDULED, TIMED, POSTPONED, CANCELLED, SUSPENDED
}

/** Anything in play, plus anything that finished recently enough to still matter. */
export async function getLiveAndRecent(now: Date): Promise<FixtureWithTeams[]> {
  // Two queries merged in JS rather than one `.or()` string: a hand-built nested
  // and()/in() PostgREST filter string is easy to get subtly wrong and TypeScript
  // can't check it; two plain queries plus a trivial merge+sort are just as correct
  // and much easier to read and test.
  const [live, recentFinished] = await Promise.all([
    readClient().from('fixtures').select(buildFixtureSelect()).in('status', LIVE_STATUSES),
    readClient()
      .from('fixtures')
      .select(buildFixtureSelect())
      .in('status', RECENT_FINISHED_STATUSES)
      .gte('kickoff_utc', hoursAgo(now, RECENT_WINDOW_HOURS))
      .lte('kickoff_utc', now.toISOString()),
  ]);
  if (live.error) throw new Error(`getLiveAndRecent: ${live.error.message}`);
  if (recentFinished.error) throw new Error(`getLiveAndRecent: ${recentFinished.error.message}`);
  const merged = [...(live.data ?? []), ...(recentFinished.data ?? [])] as unknown as FixtureWithTeams[];
  merged.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  return merged;
}

export async function getUpcoming(now: Date, limit = 12): Promise<FixtureWithTeams[]> {
  const { data, error } = await readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gt('kickoff_utc', now.toISOString())
    .in('status', ['SCHEDULED', 'TIMED'])
    .order('kickoff_utc', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getUpcoming: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}

export async function getFixturesInRange(
  fromIso: string,
  toIso: string,
  leagueIds?: number[],
): Promise<FixtureWithTeams[]> {
  let q = readClient()
    .from('fixtures')
    .select(buildFixtureSelect())
    .gte('kickoff_utc', fromIso)
    .lte('kickoff_utc', toIso)
    .order('kickoff_utc', { ascending: true });
  if (leagueIds && leagueIds.length > 0) q = q.in('league_id', leagueIds);
  const { data, error } = await q;
  if (error) throw new Error(`getFixturesInRange: ${error.message}`);
  return (data ?? []) as unknown as FixtureWithTeams[];
}
```

- [ ] **Step 7: Write `lib/site/queries/leagues.ts`**

```ts
import { readClient } from '@/lib/site/supabase';
import type { LeagueRow } from '@/lib/site/rows';

const ORDER: Record<string, number> = { PL: 0, PD: 1, SA: 2, BL1: 3, FL1: 4 };

/** Presentation order is the conventional one, not alphabetical or by id. */
export async function getLeagues(): Promise<LeagueRow[]> {
  const { data, error } = await readClient()
    .from('leagues')
    .select('id,fd_code,slug,name,country,emblem_url,current_season');
  if (error) throw new Error(`getLeagues: ${error.message}`);
  return ((data ?? []) as LeagueRow[])
    .slice()
    .sort((a, b) => (ORDER[a.fd_code] ?? 99) - (ORDER[b.fd_code] ?? 99));
}
```

- [ ] **Step 8: Write `lib/site/queries/news.ts`**

```ts
import { readClient } from '@/lib/site/supabase';
import type { NewsRow } from '@/lib/site/rows';

/**
 * Newest first, but rows with a null published_at sort last rather than
 * first — an article of unknown date must not pin itself to the top.
 */
export async function getTrendingNews(limit = 8): Promise<NewsRow[]> {
  const { data, error } = await readClient()
    .from('news_items')
    .select('id,source,title,summary,url,image_url,published_at,categories')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getTrendingNews: ${error.message}`);
  return (data ?? []) as NewsRow[];
}
```

- [ ] **Step 9: Run the tests**

Run: `npm test -- tests/site/queries.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 10: Prove the queries actually work against the live database**

```bash
cat > /tmp/probe.ts <<'EOF'
import 'dotenv/config';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getUpcoming, getLiveAndRecent } from '@/lib/site/queries/fixtures';
import { getTrendingNews } from '@/lib/site/queries/news';
const now = new Date();
console.log('leagues :', (await getLeagues()).map(l => l.fd_code).join(' '));
const up = await getUpcoming(now, 3);
console.log('upcoming:', up.length);
for (const f of up) console.log('  ', f.kickoff_utc.slice(0,16), f.home?.name, 'v', f.away?.name, '| crest', !!f.home?.crest_url);
console.log('live/rec:', (await getLiveAndRecent(now)).length);
console.log('news    :', (await getTrendingNews(3)).map(n => n.title.slice(0,40)));
EOF
cp /tmp/probe.ts ./probe.ts && npx tsx --env-file=.env.local ./probe.ts; rm -f ./probe.ts
```

Expected: five league codes in conventional order; three upcoming fixtures with real club names and `crest true`; `live/rec: 0` (preseason — correct); three news headlines.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: read-only site data layer over Supabase"
```

---

### Task 3: Formatting and monogram helpers

**Files:**
- Create: `lib/site/format.ts`, `lib/site/monogram.ts`
- Test: `tests/site/format.test.ts`, `tests/site/monogram.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatKickoff(iso: string, now: Date): string`
  - `relativeTime(iso: string | null, now: Date): string | null`
  - `dataAge(updatedAt: string, now: Date): string`
  - `monogram(name: string): string`
  - `monogramColor(name: string): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/site/monogram.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { monogram, monogramColor } from '@/lib/site/monogram';

describe('monogram', () => {
  it('takes initials from a multi-word club name', () => {
    expect(monogram('Manchester United FC')).toBe('MU');
  });
  it('drops common club-type suffixes so they never become initials', () => {
    expect(monogram('Arsenal FC')).toBe('AR');
    expect(monogram('FC Bayern München')).toBe('BM');
  });
  it('falls back to the first two letters of a single-word name', () => {
    expect(monogram('Juventus')).toBe('JU');
  });
  it('strips diacritics so the glyph is always renderable', () => {
    expect(monogram('Atlético Madrid')).toBe('AM');
  });
  it('never returns more than two characters', () => {
    expect(monogram('Borussia Verein für Leibesübungen Mönchengladbach').length).toBeLessThanOrEqual(2);
  });
  it('returns a stable placeholder for an empty name rather than throwing', () => {
    expect(monogram('')).toBe('??');
  });
});

describe('monogramColor', () => {
  it('is deterministic for the same club', () => {
    expect(monogramColor('Arsenal FC')).toBe(monogramColor('Arsenal FC'));
  });
  it('differs between clubs', () => {
    expect(monogramColor('Arsenal FC')).not.toBe(monogramColor('Chelsea FC'));
  });
  it('returns a hex colour', () => {
    expect(monogramColor('Arsenal FC')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

Create `tests/site/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatKickoff, relativeTime, dataAge } from '@/lib/site/format';

const now = new Date('2026-08-16T12:00:00Z');

describe('formatKickoff', () => {
  it('shows only a time for a fixture later today', () => {
    expect(formatKickoff('2026-08-16T19:00:00Z', now)).toMatch(/^\d{2}:\d{2}$/);
  });
  it('shows a weekday and time within the coming week', () => {
    expect(formatKickoff('2026-08-18T19:00:00Z', now)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  });
  it('shows a date for anything further out', () => {
    expect(formatKickoff('2026-10-01T19:00:00Z', now)).toMatch(/\d{1,2} [A-Z][a-z]{2}/);
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
});

describe('dataAge', () => {
  it('says just now for something within the minute', () => {
    expect(dataAge('2026-08-16T11:59:40Z', now)).toBe('just now');
  });
  it('otherwise reads as an update stamp', () => {
    expect(dataAge('2026-08-16T11:30:00Z', now)).toBe('updated 30 min ago');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- tests/site/`
Expected: FAIL — cannot find `@/lib/site/monogram` and `@/lib/site/format`

- [ ] **Step 3: Write `lib/site/monogram.ts`**

```ts
/** Words that describe the club type rather than name it. */
const NOISE = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'ss', 'sv', 'vfl', 'vfb', 'bsc', 'club', 'de', 'the', 'us', 'ud', 'rc', 'cd']);

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOISE.has(w.toLowerCase()));
}

/** Two-character stand-in used wherever a crest is missing. Never throws. */
export function monogram(name: string): string {
  const parts = words(name);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase().padEnd(2, '?');
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const PALETTE = [
  '#B23A48', '#1D6A96', '#3E7C4A', '#8A5A2B', '#5B4B8A',
  '#2E7D7B', '#9C4F2A', '#4A5D23', '#7A3B6B', '#2F4858',
];

/** Deterministic so a club's placeholder colour never changes between renders. */
export function monogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
```

- [ ] **Step 4: Write `lib/site/format.ts`**

```ts
const DAY_MS = 86_400_000;

function utc(iso: string): Date { return new Date(iso); }

/** Times are rendered in UTC so server and client agree and hydration is stable. */
function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatKickoff(iso: string, now: Date): string {
  const d = utc(iso);
  const sameDay = d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) return hhmm(d);
  const delta = d.getTime() - now.getTime();
  if (delta > 0 && delta < 7 * DAY_MS) return `${DAYS[d.getUTCDay()]} ${hhmm(d)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Null in, null out — a missing timestamp is never guessed at. */
export function relativeTime(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const diff = now.getTime() - utc(iso).getTime();
  if (Number.isNaN(diff)) return null;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function dataAge(updatedAt: string, now: Date): string {
  const rel = relativeTime(updatedAt, now);
  if (rel === null) return 'update time unknown';
  return rel === 'just now' ? 'just now' : `updated ${rel}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/site/`
Expected: PASS, 19 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: kickoff formatting and deterministic club monograms"
```

---

### Task 4: Shared presentation components

**Files:**
- Create: `components/Crest.tsx`, `components/ScoreRow.tsx`, `components/DataAge.tsx`, `components/ThemeToggle.tsx`
- Modify: `app/layout.tsx` (header, nav, footer)

**Interfaces:**
- Consumes: `monogram`, `monogramColor`, `formatKickoff`, `dataAge`, `TeamLite`, `FixtureWithTeams`.
- Produces:
  - `<Crest team={TeamLite | null} size={number} />`
  - `<ScoreRow fixture={FixtureWithTeams} now={Date} />`
  - `<DataAge updatedAt={string} now={Date} />`
  - `<ThemeToggle />`

- [ ] **Step 1: Write `components/Crest.tsx`**

A missing crest is the *normal* case for many clubs, so the fallback is designed rather than apologetic.

```tsx
'use client';

import Image from 'next/image';
import { useState } from 'react';
import { monogram, monogramColor } from '@/lib/site/monogram';
import type { TeamLite } from '@/lib/site/rows';

export function Crest({ team, size = 24 }: { team: TeamLite | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = team?.name ?? 'Unknown club';
  const showImage = team?.crest_url != null && !failed;

  if (showImage) {
    return (
      <Image
        src={team!.crest_url!}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="shrink-0 object-contain"
        /* Crests are small, already-optimised PNGs on a CDN. Next's optimizer
           would bill Netlify credits per transform for no visual gain. */
        unoptimized
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: monogramColor(name), fontSize: size * 0.38 }}
      className="shrink-0 grid place-items-center rounded-full font-bold tracking-tight text-white"
    >
      {monogram(name)}
    </span>
  );
}
```

- [ ] **Step 2: Write `components/DataAge.tsx`**

```tsx
import { dataAge } from '@/lib/site/format';

export function DataAge({ updatedAt, now }: { updatedAt: string; now: Date }) {
  return (
    <span className="text-[11px] text-muted tabular-nums" title={updatedAt}>
      {dataAge(updatedAt, now)}
    </span>
  );
}
```

- [ ] **Step 3: Write `components/ScoreRow.tsx`**

Live state carries a dot, a pulsing indicator *and* the word "Live" — never colour alone.

```tsx
import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { formatKickoff } from '@/lib/site/format';
import type { FixtureWithTeams } from '@/lib/site/rows';

const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const PLAYED = new Set(['FINISHED', 'AWARDED']);
const DEAD = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED']);

function Side({ team }: { team: FixtureWithTeams['home'] }) {
  const label = team?.short_name ?? team?.name ?? 'TBC';
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <Crest team={team} size={22} />
      <span className="truncate text-sm font-medium">{label}</span>
    </span>
  );
  return team ? <Link href={`/team/${team.slug}`} className="min-w-0 flex-1 hover:underline">{body}</Link>
              : <span className="min-w-0 flex-1">{body}</span>;
}

export function ScoreRow({ fixture, now }: { fixture: FixtureWithTeams; now: Date }) {
  const live = LIVE.has(fixture.status);
  const played = PLAYED.has(fixture.status);
  const dead = DEAD.has(fixture.status);
  const hasScore = fixture.home_goals !== null && fixture.away_goals !== null;

  return (
    <li
      data-fixture-id={fixture.id}
      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
    >
      <Side team={fixture.home} />

      <span className="shrink-0 text-center text-sm font-bold tabular-nums" data-role="score">
        {hasScore ? `${fixture.home_goals}–${fixture.away_goals}`
                  : dead ? '—'
                  : formatKickoff(fixture.kickoff_utc, now)}
      </span>

      <Side team={fixture.away} />

      <span className="w-16 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide" data-role="state">
        {live && (
          <span className="inline-flex items-center gap-1 text-live">
            <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
            Live
          </span>
        )}
        {!live && dead && <span className="text-muted">{fixture.status === 'POSTPONED' ? 'Postponed' : 'Off'}</span>}
        {!live && played && <span className="text-muted">FT</span>}
      </span>
    </li>
  );
}
```

- [ ] **Step 4: Write `components/ThemeToggle.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('touchline-theme');
    if (stored === 'light' || stored === 'dark') { setTheme(stored); return; }
    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('touchline-theme', next);
  }

  return (
    <button
      onClick={toggle}
      className="rounded border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-text"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === null ? '·' : theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
```

- [ ] **Step 5: Put the shell into `app/layout.tsx`**

Replace the `<body>` contents:

```tsx
      <body className="min-h-dvh font-sans antialiased">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <a href="/" className="text-lg font-extrabold tracking-tight">
              TOUCH<span className="text-accent">LINE</span>
            </a>
            <nav className="flex gap-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <a href="/scores" className="hover:text-text">Scores</a>
              <a href="/calendar" className="hover:text-text">Calendar</a>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mt-12 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-6 text-[11px] text-muted">
            Data from football-data.org and the Fantasy Premier League API. Headlines link to their publishers.
          </div>
        </footer>
      </body>
```

and add `import { ThemeToggle } from '@/components/ThemeToggle';` at the top.

- [ ] **Step 6: Verify the build**

```bash
npm run build && npm run typecheck
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: crest with monogram fallback, score row, theme toggle and app shell"
```

---

### Task 5: Live patching without losing page state

**Files:**
- Create: `lib/site/livePatch.ts`, `app/api/live/route.ts`, `components/LiveScores.tsx`
- Test: `tests/site/livePatch.test.ts`

**Interfaces:**
- Consumes: `getLiveAndRecent`, `ScoreRow`, `DataAge`.
- Produces:
  - `interface LivePatch { id: number; status: string; home_goals: number | null; away_goals: number | null; updated_at: string }`
  - `applyPatches(current: FixtureWithTeams[], patches: LivePatch[]): FixtureWithTeams[]`
  - `GET /api/live` → `{ now: string, fixtures: LivePatch[] }`
  - `<LiveScores initial={FixtureWithTeams[]} nowIso={string} />`

**Why the patch logic lives in `lib/site/`, not in the component:** `components/LiveScores.tsx` is a client component that imports `next/link`, `next/image` and JSX. A Vitest test importing it would fail to resolve any of those under the node environment. The pure function is therefore its own module with no React dependency, which is also what makes it directly testable.

The whole point of this task: a score changing must **not** re-render the page, reset scroll, or drop the league filter.

- [ ] **Step 1: Write the failing test**

Create `tests/site/livePatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyPatches } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const base: FixtureWithTeams = {
  id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
  status: 'IN_PLAY', matchday: 1, home_goals: 0, away_goals: 0,
  updated_at: '2026-08-16T14:30:00Z',
  home: { id: 10, slug: 'a', name: 'A', short_name: 'A', tla: 'AAA', crest_url: null },
  away: { id: 11, slug: 'b', name: 'B', short_name: 'B', tla: 'BBB', crest_url: null },
};

describe('applyPatches', () => {
  it('updates the score of a matching fixture', () => {
    const out = applyPatches([base], [{ id: 1, status: 'IN_PLAY', home_goals: 1, away_goals: 0, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBe(1);
  });

  it('preserves joined team data the patch does not carry', () => {
    const out = applyPatches([base], [{ id: 1, status: 'IN_PLAY', home_goals: 2, away_goals: 1, updated_at: 'x' }]);
    expect(out[0]!.home!.name).toBe('A');
    expect(out[0]!.away!.slug).toBe('b');
  });

  it('leaves fixtures with no patch untouched, by identity', () => {
    const other = { ...base, id: 2 };
    const out = applyPatches([base, other], [{ id: 1, status: 'IN_PLAY', home_goals: 3, away_goals: 0, updated_at: 'x' }]);
    expect(out[1]).toBe(other);
  });

  it('ignores a patch for a fixture not on the page', () => {
    const out = applyPatches([base], [{ id: 999, status: 'IN_PLAY', home_goals: 9, away_goals: 9, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBe(0);
    expect(out).toHaveLength(1);
  });

  it('carries a status transition through to full time', () => {
    const out = applyPatches([base], [{ id: 1, status: 'FINISHED', home_goals: 2, away_goals: 2, updated_at: 'x' }]);
    expect(out[0]!.status).toBe('FINISHED');
  });

  it('accepts a null score without coercing it to zero', () => {
    const out = applyPatches([base], [{ id: 1, status: 'POSTPONED', home_goals: null, away_goals: null, updated_at: 'x' }]);
    expect(out[0]!.home_goals).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/site/livePatch.test.ts`
Expected: FAIL — `Cannot find module '@/lib/site/livePatch'`

- [ ] **Step 3: Write `lib/site/livePatch.ts`**

```ts
import type { FixtureWithTeams } from '@/lib/site/rows';

/** The minimal shape /api/live returns — scores and status, nothing joined. */
export interface LivePatch {
  id: number;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  updated_at: string;
}

/**
 * Returns a new array only where something actually changed. Unchanged
 * fixtures keep their original object identity so React skips re-rendering
 * those rows — that is what keeps scroll position and open state intact
 * when a goal lands.
 */
export function applyPatches(
  current: FixtureWithTeams[],
  patches: LivePatch[],
): FixtureWithTeams[] {
  if (patches.length === 0) return current;
  const byId = new Map(patches.map((p) => [p.id, p]));
  return current.map((f) => {
    const p = byId.get(f.id);
    if (!p) return f;
    if (p.status === f.status && p.home_goals === f.home_goals && p.away_goals === f.away_goals) return f;
    return {
      ...f,
      status: p.status,
      home_goals: p.home_goals,
      away_goals: p.away_goals,
      updated_at: p.updated_at,
    };
  });
}
```

- [ ] **Step 4: Write `app/api/live/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getLiveAndRecent } from '@/lib/site/queries/fixtures';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const fixtures = await getLiveAndRecent(now);
  return NextResponse.json(
    {
      now: now.toISOString(),
      fixtures: fixtures.map((f) => ({
        id: f.id,
        status: f.status,
        home_goals: f.home_goals,
        away_goals: f.away_goals,
        updated_at: f.updated_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 5: Write `components/LiveScores.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { ScoreRow } from '@/components/ScoreRow';
import { DataAge } from '@/components/DataAge';
import { applyPatches, type LivePatch } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const POLL_MS = 60_000;

export function LiveScores({ initial, nowIso }: { initial: FixtureWithTeams[]; nowIso: string }) {
  const [fixtures, setFixtures] = useState(initial);
  const [stamp, setStamp] = useState(nowIso);

  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { now: string; fixtures: LivePatch[] };
        if (cancelled) return;
        setFixtures((prev) => applyPatches(prev, body.fixtures));
        setStamp(body.now);
      } catch {
        /* A failed poll is not worth disturbing the page for; the next one retries. */
      }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const now = new Date(stamp);
  const newest = fixtures.reduce<string | null>(
    (acc, f) => (acc === null || f.updated_at > acc ? f.updated_at : acc), null);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Live &amp; recent</h2>
        {newest && <DataAge updatedAt={newest} now={now} />}
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {fixtures.map((f) => <ScoreRow key={f.id} fixture={f} now={now} />)}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- tests/site/livePatch.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 7: Verify the endpoint answers against real data**

```bash
npm run build && (npm start &) && sleep 6
curl -s localhost:3000/api/live | head -c 300; echo
kill %1
```

Expected: `{"now":"2026-…","fixtures":[]}` — an empty array is correct during preseason.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: live score patching that preserves page state"
```

---

### Task 6: `/scores`

**Files:**
- Create: `app/scores/page.tsx`, `components/LeagueFilter.tsx`

**Interfaces:**
- Consumes: `getLeagues`, `getLiveAndRecent`, `getUpcoming` (Task 2); `ScoreRow`, `DataAge` (Task 4); `<LiveScores initial={FixtureWithTeams[]} nowIso={string} />` (Task 5).
- Produces: the `/scores` route, and `<LeagueFilter leagues={LeagueRow[]} selected={string[]} basePath={string} />`.

- [ ] **Step 1: Write `components/LeagueFilter.tsx`**

Filters live in the query string, so a refresh or a shared link preserves them — the requirement that refreshing must not lose the user's place.

```tsx
import Link from 'next/link';
import type { LeagueRow } from '@/lib/site/rows';

export function LeagueFilter({
  leagues, selected, basePath,
}: { leagues: LeagueRow[]; selected: string[]; basePath: string }) {
  function hrefFor(code: string | null): string {
    if (code === null) return basePath;
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code];
    return next.length === 0 ? basePath : `${basePath}?leagues=${next.join(',')}`;
  }

  const allActive = selected.length === 0;

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Filter by competition">
      <Link
        href={hrefFor(null)}
        aria-current={allActive ? 'true' : undefined}
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
          allActive ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:text-text'
        }`}
      >
        All
      </Link>
      {leagues.map((l) => {
        const active = selected.includes(l.fd_code);
        return (
          <Link
            key={l.fd_code}
            href={hrefFor(l.fd_code)}
            aria-current={active ? 'true' : undefined}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              active ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:text-text'
            }`}
          >
            {l.name}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write `app/scores/page.tsx`**

The preseason state is a real designed view, not an empty list — during August that is the *only* thing anyone will see.

```tsx
import { getLeagues } from '@/lib/site/queries/leagues';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { LeagueFilter } from '@/components/LeagueFilter';
import { ScoreRow } from '@/components/ScoreRow';
import { LiveScores } from '@/components/LiveScores';
import { formatKickoff } from '@/lib/site/format';

export const revalidate = 60;

export default async function ScoresPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  const selected = raw ? raw.split(',').filter(Boolean) : [];

  const now = new Date();
  const [leagues, recent, upcoming] = await Promise.all([
    getLeagues(),
    getLiveAndRecent(now),
    getUpcoming(now, 20),
  ]);

  const byId = new Map(leagues.map((l) => [l.id, l]));
  const keep = (leagueId: number) =>
    selected.length === 0 || selected.includes(byId.get(leagueId)?.fd_code ?? '');

  const shownRecent = recent.filter((f) => keep(f.league_id));
  const shownUpcoming = upcoming.filter((f) => keep(f.league_id));
  const nextKickoff = shownUpcoming[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Scores</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/scores" />
      </div>

      {shownRecent.length > 0 ? (
        <LiveScores initial={shownRecent} nowIso={now.toISOString()} />
      ) : (
        <section className="rounded-xl border border-border bg-surface p-6">
          <p className="text-sm font-semibold">No matches in progress</p>
          <p className="mt-1 text-sm text-muted">
            {nextKickoff
              ? <>Next up: {nextKickoff.home?.name} v {nextKickoff.away?.name}, {formatKickoff(nextKickoff.kickoff_utc, now)}.</>
              : <>No fixtures scheduled in the selected competitions.</>}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Upcoming</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {shownUpcoming.length === 0 && (
            <li className="px-3 py-6 text-sm text-muted">Nothing scheduled.</li>
          )}
          {shownUpcoming.map((f) => <ScoreRow key={f.id} fixture={f} now={now} />)}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Give CI the credentials the build now needs**

CI runs `npm run build`, and from this task onward the build executes server components that read Postgres — so it needs Supabase credentials or it fails with a network error that looks nothing like a type error.

Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.github/workflows/ci.yml`'s build step only. **This does not weaken CI's no-live-provider-call guarantee:** the anon key is SELECT-only, RLS-enforced, and ships to browsers by design, so it is not a secret in the sense the football-data key is. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` or `FOOTBALL_DATA_KEY` — those must never reach a build.

- [ ] **Step 4: Build and check the route renders**

```bash
npm run build
```

Expected: build succeeds and lists `/scores` as a dynamic route.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: /scores with league filter and designed preseason state"
```

---

### Task 7: `/calendar` and iCalendar export

**Files:**
- Create: `app/calendar/page.tsx`, `app/api/calendar.ics/route.ts`, `lib/site/ics.ts`
- Test: `tests/site/ics.test.ts`

**Interfaces:**
- Consumes: `getFixturesInRange`, `getLeagues`, `LeagueFilter`, `Crest`.
- Produces: `buildIcs(fixtures: FixtureWithTeams[], leagueName: (id: number) => string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/site/ics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIcs } from '@/lib/site/ics';
import type { FixtureWithTeams } from '@/lib/site/rows';

const f: FixtureWithTeams = {
  id: 7, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T19:00:00Z',
  status: 'SCHEDULED', matchday: 1, home_goals: null, away_goals: null,
  updated_at: '2026-08-04T00:00:00Z',
  home: { id: 1, slug: 'rm', name: 'Real Madrid CF', short_name: 'Real Madrid', tla: 'RMA', crest_url: null },
  away: { id: 2, slug: 'fcb', name: 'FC Barcelona', short_name: 'Barça', tla: 'FCB', crest_url: null },
};

describe('buildIcs', () => {
  const ics = buildIcs([f], () => 'La Liga');

  it('is a well-formed calendar', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('names the fixture and its competition', () => {
    expect(ics).toContain('SUMMARY:Real Madrid CF v FC Barcelona');
    expect(ics).toContain('La Liga');
  });

  it('writes UTC timestamps in iCalendar basic format', () => {
    expect(ics).toContain('DTSTART:20260816T190000Z');
  });

  it('gives every event a stable UID derived from the fixture id', () => {
    expect(ics).toContain('UID:fixture-7@touchline');
  });

  it('assumes a two-hour duration so calendars block sensible time', () => {
    expect(ics).toContain('DTEND:20260816T210000Z');
  });

  it('uses CRLF line endings, which the spec requires', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('escapes commas in club names rather than breaking the field', () => {
    const odd = { ...f, home: { ...f.home!, name: 'Club A, B' } };
    expect(buildIcs([odd], () => 'X')).toContain('Club A\\, B');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/site/ics.test.ts`
Expected: FAIL — `Cannot find module '@/lib/site/ics'`

- [ ] **Step 3: Write `lib/site/ics.ts`**

```ts
import type { FixtureWithTeams } from '@/lib/site/rows';

const MATCH_MINUTES = 120;

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Commas, semicolons and newlines are field separators in iCalendar. */
function esc(text: string): string {
  return text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

export function buildIcs(
  fixtures: FixtureWithTeams[],
  leagueName: (leagueId: number) => string,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Touchline//Fixtures//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Touchline fixtures',
  ];

  for (const f of fixtures) {
    const home = f.home?.name ?? 'TBC';
    const away = f.away?.name ?? 'TBC';
    const end = new Date(new Date(f.kickoff_utc).getTime() + MATCH_MINUTES * 60_000).toISOString();
    lines.push(
      'BEGIN:VEVENT',
      `UID:fixture-${f.id}@touchline`,
      `DTSTAMP:${stamp(f.updated_at)}`,
      `DTSTART:${stamp(f.kickoff_utc)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${home} v ${away}`)}`,
      `DESCRIPTION:${esc(leagueName(f.league_id))}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Write `app/api/calendar.ics/route.ts`**

```ts
import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { buildIcs } from '@/lib/site/ics';

export const revalidate = 3600;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codes = (url.searchParams.get('leagues') ?? '').split(',').filter(Boolean);

  const leagues = await getLeagues();
  const ids = codes.length > 0
    ? leagues.filter((l) => codes.includes(l.fd_code)).map((l) => l.id)
    : undefined;

  const now = new Date();
  const to = new Date(now.getTime() + 120 * 86_400_000);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString(), ids);

  const nameById = new Map(leagues.map((l) => [l.id, l.name]));
  const body = buildIcs(fixtures, (id) => nameById.get(id) ?? 'Football');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="touchline.ics"',
    },
  });
}
```

- [ ] **Step 5: Write `app/calendar/page.tsx`**

```tsx
import Link from 'next/link';
import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { LeagueFilter } from '@/components/LeagueFilter';
import { Crest } from '@/components/Crest';
import { formatKickoff } from '@/lib/site/format';

export const revalidate = 900;

const DAY_MS = 86_400_000;

export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string; weeks?: string }> }) {
  const { leagues: raw, weeks: weeksRaw } = await searchParams;
  const selected = raw ? raw.split(',').filter(Boolean) : [];
  const weeks = Math.min(Math.max(Number.parseInt(weeksRaw ?? '4', 10) || 4, 1), 12);

  const leagues = await getLeagues();
  const ids = selected.length > 0
    ? leagues.filter((l) => selected.includes(l.fd_code)).map((l) => l.id)
    : undefined;

  const now = new Date();
  const to = new Date(now.getTime() + weeks * 7 * DAY_MS);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString(), ids);

  const nameById = new Map(leagues.map((l) => [l.id, l.name]));
  const byDay = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    const day = f.kickoff_utc.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), f]);
  }

  const icsHref = selected.length > 0
    ? `/api/calendar.ics?leagues=${selected.join(',')}`
    : '/api/calendar.ics';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/calendar" />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-muted">Showing the next {weeks} week{weeks === 1 ? '' : 's'}</span>
        <a href={icsHref} className="rounded border border-border px-2 py-1 font-semibold uppercase tracking-wider text-muted hover:text-text">
          Subscribe (.ics)
        </a>
      </div>

      {byDay.size === 0 && (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No fixtures in this window for the selected competitions.
        </p>
      )}

      <div className="space-y-5">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {new Date(`${day}T00:00:00Z`).toUTCString().slice(0, 11)}
            </h2>
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {list.map((f) => (
                <li key={f.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <span className="w-12 shrink-0 text-xs text-muted tabular-nums">{formatKickoff(f.kickoff_utc, now)}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Crest team={f.home} size={20} />
                    <span className="truncate text-sm">{f.home?.name ?? 'TBC'}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">v</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Crest team={f.away} size={20} />
                    <span className="truncate text-sm">{f.away?.name ?? 'TBC'}</span>
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-[11px] text-muted sm:block">
                    {nameById.get(f.league_id)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-muted">
        Times shown in UTC. <Link href="/scores" className="underline">Scores</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and build**

```bash
npm test -- tests/site/ics.test.ts
npm run build
```

Expected: 7 tests pass; build clean.

- [ ] **Step 7: Verify the export against real data**

```bash
(npm start &) && sleep 6
curl -s "localhost:3000/api/calendar.ics" | head -20
kill %1
```

Expected: a `BEGIN:VCALENDAR` block containing real upcoming fixtures.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: /calendar with league filters and .ics subscription"
```

---

### Task 8: Landing page

**Files:**
- Create: `app/page.tsx` (replacing the placeholder), `components/Countdown.tsx`, `components/NewsCard.tsx`
- Modify: `lib/site/queries/leagues.ts` (add `getNextKickoffPerLeague`)

**Interfaces:**
- Consumes: `getTrendingNews`, `getUpcoming`, `getLiveAndRecent`, `getLeagues`, `ScoreRow`, `Crest`.
- Produces: `getNextKickoffPerLeague(now: Date): Promise<Array<{ league: LeagueRow; kickoffUtc: string | null }>>`

- [ ] **Step 1: Add the query to `lib/site/queries/leagues.ts`**

```ts
import { getFixturesInRange } from '@/lib/site/queries/fixtures';

/** Earliest scheduled kickoff per competition — drives the preseason countdown. */
export async function getNextKickoffPerLeague(
  now: Date,
): Promise<Array<{ league: LeagueRow; kickoffUtc: string | null }>> {
  const leagues = await getLeagues();
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString());
  const earliest = new Map<number, string>();
  for (const f of fixtures) {
    const seen = earliest.get(f.league_id);
    if (seen === undefined || f.kickoff_utc < seen) earliest.set(f.league_id, f.kickoff_utc);
  }
  return leagues.map((league) => ({ league, kickoffUtc: earliest.get(league.id) ?? null }));
}
```

- [ ] **Step 2: Write `components/Countdown.tsx`**

Rendered on the server from a fixed `now` so there is no hydration mismatch; it does not tick, which is correct for a multi-day countdown.

```tsx
export function Countdown({ targetIso, now }: { targetIso: string; now: Date }) {
  const ms = new Date(targetIso).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <span className="text-sm font-bold tabular-nums">
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`}
    </span>
  );
}
```

- [ ] **Step 3: Write `components/NewsCard.tsx`**

Headlines link out to the publisher; we never reproduce article text.

```tsx
import { relativeTime } from '@/lib/site/format';
import type { NewsRow } from '@/lib/site/rows';

export function NewsCard({ item, now, lead = false }: { item: NewsRow; now: Date; lead?: boolean }) {
  const age = relativeTime(item.published_at, now);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-border bg-surface p-4 hover:border-muted"
    >
      {item.categories.includes('transfer') && (
        <span className="mb-2 inline-block rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-ink">
          Transfer
        </span>
      )}
      {item.categories.includes('injury') && (
        <span className="mb-2 ml-1 inline-block rounded border border-live px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-live">
          Injury
        </span>
      )}
      <h3 className={lead ? 'text-xl font-extrabold leading-tight tracking-tight' : 'text-sm font-semibold leading-snug'}>
        {item.title}
      </h3>
      {lead && item.summary && <p className="mt-2 text-sm text-muted">{item.summary}</p>}
      <p className="mt-2 text-[11px] text-muted">
        {item.source}{age ? ` · ${age}` : ''}
      </p>
    </a>
  );
}
```

- [ ] **Step 4: Write `app/page.tsx`**

```tsx
import Link from 'next/link';
import { getTrendingNews } from '@/lib/site/queries/news';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague } from '@/lib/site/queries/leagues';
import { LiveScores } from '@/components/LiveScores';
import { NewsCard } from '@/components/NewsCard';
import { Countdown } from '@/components/Countdown';
import { Crest } from '@/components/Crest';
import { formatKickoff } from '@/lib/site/format';

export const revalidate = 300;

export default async function Home() {
  const now = new Date();
  const [news, live, upcoming, seasons] = await Promise.all([
    getTrendingNews(7),
    getLiveAndRecent(now),
    getUpcoming(now, 6),
    getNextKickoffPerLeague(now),
  ]);

  const [lead, ...rest] = news;
  const pending = seasons.filter((s) => s.kickoffUtc !== null);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <section className="space-y-4">
          {lead ? <NewsCard item={lead} now={now} lead /> : (
            <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
              No headlines yet — the news job runs every 15 minutes.
            </div>
          )}
        </section>

        {live.length > 0 ? (
          <LiveScores initial={live} nowIso={now.toISOString()} />
        ) : (
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              Season kicks off
            </h2>
            <ul className="space-y-2">
              {pending.map(({ league, kickoffUtc }) => (
                <li key={league.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-b-0 last:pb-0">
                  <span className="truncate text-sm font-medium">{league.name}</span>
                  <Countdown targetIso={kickoffUtc!} now={now} />
                </li>
              ))}
              {pending.length === 0 && <li className="text-sm text-muted">No fixtures scheduled.</li>}
            </ul>
          </section>
        )}
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Next fixtures</h2>
          <Link href="/calendar" className="text-[11px] text-muted hover:text-text">Full calendar →</Link>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
                {formatKickoff(f.kickoff_utc, now)}
              </p>
              <p className="flex items-center gap-2 text-sm"><Crest team={f.home} size={18} />{f.home?.short_name ?? f.home?.name}</p>
              <p className="mt-1 flex items-center gap-2 text-sm"><Crest team={f.away} size={18} />{f.away?.short_name ?? f.away?.name}</p>
            </li>
          ))}
          {upcoming.length === 0 && <li className="text-sm text-muted">Nothing scheduled.</li>}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((n) => <NewsCard key={n.id} item={n} now={now} />)}
      </section>

      <section className="rounded-xl border border-dashed border-border p-6">
        <h2 className="text-sm font-bold">Fantasy — coming soon</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Pick a squad from across the top five leagues, score points on real results, and run a
          league against your friends. In development.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Build and commit**

```bash
npm run build && npm run typecheck
git add -A
git commit -m "feat: landing page with trending news, kickoff countdown and next fixtures"
```

---

### Task 9: Netlify deployment and end-to-end tests

**Files:**
- Create: `netlify.toml`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: every route.
- Produces: a deployed site and a passing E2E suite.

- [ ] **Step 1: Install Playwright**

```bash
npm i -D @playwright/test
npx playwright install chromium
npm pkg set scripts.e2e="playwright test"
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000',
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 3: Write `e2e/smoke.spec.ts`**

The middle test is the one that matters: it proves the specific requirement that a refresh keeps the user's place.

```ts
import { test, expect } from '@playwright/test';

test('landing page renders real data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /TOUCHLINE/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Fantasy — coming soon/i })).toBeVisible();
  await expect(page.locator('text=Next fixtures')).toBeVisible();
});

test('a filter survives a hard refresh', async ({ page }) => {
  await page.goto('/scores');
  await page.getByRole('link', { name: 'La Liga' }).click();
  await expect(page).toHaveURL(/leagues=PD/);
  await page.reload();
  await expect(page).toHaveURL(/leagues=PD/);
  await expect(page.getByRole('link', { name: 'La Liga' })).toHaveAttribute('aria-current', 'true');
});

test('the calendar exports a valid ics file', async ({ request }) => {
  const res = await request.get('/api/calendar.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
});

test('the live endpoint answers with a fixture array', async ({ request }) => {
  const res = await request.get('/api/live');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.fixtures)).toBe(true);
});

test('the theme toggle persists across a reload', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'unset');
  await page.getByRole('button', { name: /Switch to/ }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
});
```

- [ ] **Step 4: Write `netlify.toml`**

Deploy previews are disabled because each production deploy costs 15 of 300 monthly credits; previews would burn the budget on branches.

```toml
[build]
  command = "npm run build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "24"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[context.deploy-preview]
  command = "echo 'previews disabled to conserve free-tier credits'"

[[headers]]
  for = "/api/live"
  [headers.values]
    Cache-Control = "no-store"
```

- [ ] **Step 5: Run the E2E suite locally**

```bash
npm run e2e
```

Expected: 5 passed.

- [ ] **Step 6: Add Playwright output to `.gitignore`**

```
playwright-report/
test-results/
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Netlify config and end-to-end smoke suite"
```

- [ ] **Step 8: Deploy (project owner action)**

Netlify → Add new site → Import from GitHub → pick `Kinshuk28/touchline`. Set environment variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` **only** — the service-role key must never be set on the site, since the site never writes.

Confirm after deploy: the landing page renders, `/scores` shows the preseason state, `/api/calendar.ics` downloads, and the theme toggle persists.

---

## Phase B1: definition of done

- [ ] `npm run build`, `npm test`, `npm run typecheck` all clean
- [ ] `npm run e2e` passes all five specs
- [ ] `/`, `/scores`, `/calendar` render real data with real crests
- [ ] Every club without a crest shows a coloured monogram, never a broken image
- [ ] A league filter survives a hard refresh, in the URL
- [ ] Live scores patch in place without resetting scroll or filters
- [ ] Both themes meet WCAG AA and the choice persists
- [ ] Deployed to Netlify with only the anon key present

---

## Carried into Plan B2

`/league/[slug]`, `/team/[slug]`, `/player/[slug]`, `/news`, `/transfers`, `/search`, `/status` — plus the Phase A follow-up that populates `news_items.league_id` and `team_ids`, without which `/news` and `/transfers` cannot filter by competition or club. Club-name matching there must use word boundaries: naive substring matching tags *"Newcastle sign Braga keeper Hornicek"* as **Nice**, because "nice" sits inside "Hornicek".
