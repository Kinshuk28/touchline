# Touchline — Phase A + B Design

**Date:** 2026-08-03
**Scope:** Phase A (data spine) and Phase B (public site)
**Out of scope:** Phase C (accounts, comments), Phase D (fantasy game)

---

## 1. Purpose

A single place to follow the top five European leagues — Premier League, La Liga, Serie A, Bundesliga, Ligue 1 — covering live scores, fixtures, league tables, squads, player statistics, injuries, transfers, aggregated news, and a fixture calendar.

The product is judged on two things: whether the data is current, and whether pages appear instantly. Every decision below serves one of those.

### Phase decomposition

The original brief spans four independent subsystems. They ship in order, each with its own spec:

| Phase | Contents | Status |
|---|---|---|
| **A** | Ingestion pipeline, budget control, canonical store | This spec |
| **B** | Public site: landing, scores, calendar, leagues, teams, players, news, transfers, search | This spec |
| **C** | Accounts, comments, reactions, followed teams | Later spec |
| **D** | Fantasy game | Later spec |

A + B together are a complete, shippable product. C and D depend on both.

---

## 2. Constraints that shape the design

These are facts established during design, not preferences. They are the reason the architecture looks the way it does.

**football-data.org free tier** provides fixtures, schedules and league tables only, all delayed. It does **not** include live scores, lineups, goal scorers, or squad data — those are paid (€12–29/mo).

**API-Football free tier** provides everything (live scores, injuries, transfers, player statistics, images) but is capped at **100 requests per day, total**.

**Consequence:** the site cannot call a provider in response to a user action. At any real traffic level the daily cap would be exhausted in seconds. All provider traffic must be scheduled, server-side, and budget-controlled; users read only from our own database.

**Netlify's free tier is credit-based:** 300 credits/month, with production deploys at 15 credits each (~20 deploys/month) and a 10-second function timeout. Ingestion therefore does **not** run on Netlify Functions — the timeout is too tight for batch jobs and deploys are the scarce resource. Netlify hosts and serves only.

**Ingestion runs on GitHub Actions:** unlimited minutes on public repositories, no execution timeout, cron intervals down to 5 minutes. Workflows write directly to Supabase and consume no Netlify credits.

**Hard project constraint: no paid services, ever.** Every component must sit inside a permanent free tier. Where a limit binds, the product accepts the limit rather than the invoice.

**Decision:** build entirely on free tiers, with the ingestion layer written as swappable provider adapters and all poll cadences in configuration. Upgrading to a paid key later is an environment variable plus a number — not a rewrite. On the free tier, live scores update every ~10 minutes; on a paid key the same code polls every 15–30 seconds.

**News is aggregated, not republished.** RSS sources give headline, snippet, image and link. We store and display headline + 1–2 sentence snippet + source attribution + timestamp, linking out to the publisher. We do not reproduce full article text — it is third-party copyright.

---

## 3. Architecture

```
API-Football · football-data.org · TheSportsDB · RSS feeds
        │
        │  Netlify Scheduled Functions (cron)
        ▼
   Ingestion workers  ←──►  budget ledger
        │
        ▼
   Supabase Postgres  ── the only source pages read from
        │
        ▼
   Next.js App Router (server components) ──► Netlify CDN
```

**Invariant:** no third-party API call ever occurs on the request path of a page view. This is what makes pages fast and what makes the free tier survive traffic.

### Stack

- Next.js 15, App Router, TypeScript
- Tailwind CSS
- Supabase Postgres (also provides Auth and relational tables that phases C and D require)
- Netlify — hosting and CDN only
- GitHub Actions — all scheduled ingestion
- Vitest (unit/integration), Playwright (E2E)

**Netlify credit discipline:** at 15 credits per production deploy against 300/month, deploys are a scarce resource. Work is verified locally and in CI; production deploys are batched, not made per-commit. Deploy previews are disabled for routine branches.

Supabase's free tier pauses after 7 days idle; our hourly cron keeps it active, so this never triggers.

---

## 4. Ingestion layer (Phase A)

Four components, each independently testable.

### 4.1 Provider adapters — `lib/providers/`

One module per source, each exposing a narrow typed interface and owning its own auth, pagination, and response mapping. Nothing outside this directory knows a provider's response shape.

| Module | Source | Provides |
|---|---|---|
| `apiFootball.ts` | api-sports.io | live scores, injuries, transfers, player stats, lineups, images |
| `footballData.ts` | football-data.org | fixtures, schedules, league tables |
| `theSportsDb.ts` | TheSportsDB | crests, team and player imagery |
| `rss.ts` | BBC, Sky, Guardian, ESPN, league feeds | news headlines |

Adapters return domain types (`Fixture`, `PlayerStats`, …), never raw provider JSON.

### 4.2 Budget ledger — `lib/ingest/budget.ts`

A Postgres table counting requests per provider per UTC day against a configured limit. **Every outbound provider call is routed through it.** It refuses calls that would exceed the cap and records consumption atomically.

This is the single component that turns a 100-request cap from a daily outage into a manageable resource.

Allocation for API-Football (100/day):

| Priority | Job | Cap |
|---|---|---|
| P0 | Live scores | 60 |
| P1 | Standings, fixtures, injuries | 20 |
| P2 | Transfers | 5 |
| P3 | Player crawl | whatever remains |

football-data.org (10 req/min) and RSS (unlimited) are tracked but effectively unconstrained.

### 4.3 Priority job queue — `lib/ingest/jobs.ts`

Each scheduled invocation drains jobs highest-priority-first until the budget is exhausted or the queue empties. Lower-priority work is naturally deferred on busy matchdays and catches up on quiet days.

The player crawl (P3) is **cursor-based**: it records its position in `ingest_cursor` and resumes there on the next run, so a full pass over ~2,500 players across five leagues (~150 requests) completes over roughly 7–10 days without ever competing with live scores.

### 4.4 Match-window guard

The live-score cron first queries the **database** (free) to determine whether any tracked fixture is currently in progress. If none is, it returns immediately without spending a request.

Without this guard, polling every 10 minutes costs 144 requests/day — over budget before any other job runs. With it, live polling costs zero on non-matchdays and the full allocation only when matches are actually being played.

### 4.5 Scheduled workers — `.github/workflows/`

Ingestion runs as GitHub Actions cron workflows, not Netlify Functions. Each invokes a Node entrypoint under `scripts/ingest/` that connects to Supabase with the service role key.

| Workflow | Schedule | Work |
|---|---|---|
| `ingest-live.yml` | `*/10 * * * *` | Match-window guard, then `fixtures?live=all` (one request covers every in-play match) |
| `ingest-core.yml` | `0 * * * *` | Standings, upcoming fixtures, injuries |
| `ingest-news.yml` | `*/15 * * * *` | RSS ingest, dedupe, classify by league/team |
| `ingest-transfers.yml` | `0 6 * * *` | Daily transfer sweep |
| `ingest-players.yml` | `30 */6 * * *` | Player statistics crawl, leftover budget only |

Each workflow also declares `workflow_dispatch` so any job can be run manually from the Actions tab — the primary debugging affordance for the pipeline.

**Two GitHub Actions caveats the design must absorb:**
- Scheduled workflows are **disabled after 60 days without a repository commit**. A `keepalive.yml` workflow commits a timestamp file monthly to prevent this.
- Cron triggers are best-effort and may be **delayed under GitHub load**, occasionally by 10+ minutes. Jobs must therefore be idempotent and driven by "what is stale in the database", never by "it is now exactly 15:00".

### 4.6 Player statistics strategy

A rolling crawl covers every player in all five leagues on a ~7–10 day cycle using leftover budget, so every player has a real page. Top scorers and assisters sit in a priority tier refreshed every 2 days. If a visitor opens a player whose record is stale and budget remains, that player is refreshed on the spot.

---

## 5. Data model (Supabase Postgres)

```
leagues              id, api_football_id, football_data_id, slug, name, country,
                     logo_url, current_season

teams                id, api_football_id, league_id→leagues, slug, name, short_name,
                     crest_url, primary_color, venue, founded

players              id, api_football_id, team_id→teams, slug, name, position,
                     nationality, birth_date, height, photo_url

fixtures             id, api_football_id, league_id, home_team_id, away_team_id,
                     kickoff_utc, status, minute, home_goals, away_goals,
                     round, venue, updated_at

standings            league_id, team_id, rank, played, won, drawn, lost,
                     goals_for, goals_against, goal_diff, points, form, updated_at

player_season_stats  player_id, league_id, season, appearances, minutes, goals,
                     assists, yellow_cards, red_cards, rating, shots, passes,
                     updated_at

injuries             id, player_id, team_id, type, reason, fixture_id, updated_at

transfers            id, player_id, from_team_id, to_team_id, transfer_date,
                     type, fee_text, updated_at

news_items           id, source, title, summary, url, image_url, published_at,
                     league_id, team_ids[], content_hash

ingest_budget        provider, day_utc, requests_used, requests_limit
ingest_cursor        job, cursor, updated_at
ingest_log           id, job, status, message, requests_used, started_at, finished_at
```

Every user-facing table carries `updated_at` so pages can display data age. `news_items.content_hash` deduplicates the same story arriving from multiple feeds.

Indexes: `fixtures(kickoff_utc)`, `fixtures(status)` for the match-window guard, `standings(league_id, rank)`, `news_items(published_at DESC)`, and pg_trgm indexes on `teams.name` and `players.name` for search.

---

## 6. Site (Phase B)

### 6.1 Routes

| Route | Contents |
|---|---|
| `/` | Trending news, live-score strip, next fixtures, fantasy slot |
| `/scores` | Live and today's results across all five leagues |
| `/calendar` | Month and week fixture views, league/club filters, `.ics` export |
| `/league/[slug]` | Table, fixtures, top scorers |
| `/team/[slug]` | Squad, form, fixtures, injuries, related news |
| `/player/[slug]` | Season statistics, splits, photo, club context |
| `/news` | Aggregated feed with league/club filters |
| `/transfers` | Transfer feed |
| `/search` | Instant search across teams and players |

**Landing-page fantasy slot in phases A + B:** the layout reserves the slot, and it renders a real "Fantasy — coming soon" panel with a short description of the game. It is not hidden and not a dead placeholder; phase D replaces its contents without touching the landing-page layout.

**Search implementation:** a server route handler queries the pg_trgm indexes on `teams.name` and `players.name` and returns ranked JSON. The client input is debounced at 150ms. Results are prefetched on hover so opening one is instant. No search index is held client-side.

### 6.2 Refresh behaviour

A hard requirement: refreshing a page must refresh *that page's* data, like a normal website — never reset to an app shell or lose the user's place.

- Every view is a real URL, server-rendered from Postgres.
- Per-route revalidation: scores 60s, league and team 15min, player 6h, news 5min.
- Live views additionally poll a lightweight JSON route handler and **patch only the changed values in place**. Scroll position, active filters and expanded panels survive.
- Because rendering reads Postgres and never a provider, a hard refresh is fast regardless of provider state.

### 6.3 Visual direction — "Broadcast"

Dark-first, high contrast, matchday register. A properly built light theme ships as secondary — a careful translation, not a co-equal design.

| Token | Value |
|---|---|
| Background | `#0B0E11` |
| Surface | `#14181D` |
| Border | `#232A31` |
| Text | `#E8EDF2` |
| Muted text | `#8A94A0` |
| Accent | `#C8FF00` |
| Live indicator | `#FF3B47` |

Typography: Inter variable, tight tracking on headlines, **tabular numerals on all scores and statistics** so digits don't jitter as values update.

Accessibility: all text pairs meet WCAG AA against their background; live state is never signalled by colour alone (dot + minute label accompany it); every interactive element is keyboard reachable with a visible focus ring.

### 6.4 Imagery

Real club crests and player photography from provider CDNs. URLs stored in the database, served via `next/image` with remote patterns whitelisted and cached at the CDN edge. Every image has a coloured-monogram fallback so a missing asset never renders as a broken icon. No generated imagery anywhere in the product.

### 6.5 Performance

- All page reads hit indexed Postgres queries; no provider call on the request path, ever.
- Search uses pg_trgm indexes, with results prefetched on hover.
- Route segments are statically rendered where data allows, revalidated on the cadences above.

---

## 7. Failure handling

Ingestion failure must never break a page.

- Pages render last-known-good data from Postgres with a visible "updated N minutes ago" stamp — staleness is shown, not hidden.
- Provider errors are written to `ingest_log` with job, message and requests consumed.
- A `429` marks that provider exhausted for the remainder of the UTC day in the budget ledger; retries use exponential backoff.
- A `/status` page reports budget consumed, last successful run per job, and recent errors. A scheduled pipeline that cannot be observed cannot be operated.

---

## 8. Testing

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | Provider adapters against recorded JSON snapshots; budget ledger arithmetic and refusal behaviour; job prioritisation; match-window guard |
| Integration | Vitest + local Supabase | Ingestion → database writes, upserts, dedupe |
| E2E | Playwright | Landing renders with data; hard refresh preserves page and filters; live patch updates a score without navigation |

**No live provider calls in CI** — they would consume the production daily budget. All adapter tests run against committed response snapshots.

---

## 9. External accounts required

To be created by the project owner; none require a payment card:

- **GitHub** — account and a **public** repository (public is what makes Actions minutes unlimited)
- **api-sports.io** — API-Football free key
- **football-data.org** — free key
- **Supabase** — project (URL, anon key, service role key)
- **Netlify** — site, connected to the GitHub repository

TheSportsDB and RSS feeds require no key.

Secrets live in three places: `.env.local` for local development (gitignored), **GitHub repository secrets** for the ingestion workflows, and **Netlify environment variables** for page rendering. The service role key goes only in GitHub secrets and Netlify — never in client-side code, never committed.

---

## 10. Definition of done for A + B

- All five leagues ingesting fixtures, tables, injuries, transfers and news on schedule.
- Player crawl completing a full cycle within 10 days without ever starving live scores.
- Daily API-Football consumption stays at or under 100 requests, verified on `/status` across a full matchday.
- All nine routes rendering real data with real crests and photography.
- Hard refresh on any route re-renders that route with fresh data and preserves filters.
- Light and dark themes both meeting WCAG AA.
- Unit, integration and E2E suites passing with no live provider calls.
