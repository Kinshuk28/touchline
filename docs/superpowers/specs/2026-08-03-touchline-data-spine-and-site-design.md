# Touchline — Phase A + B Design

**Date:** 2026-08-03
**Scope:** Phase A (data spine) and Phase B (public site)
**Out of scope:** Phase C (accounts, comments), Phase D (fantasy game)
**Status:** all data sources empirically verified against live endpoints on 2026-08-03

---

## 1. Purpose

A single place to follow the top five European leagues — Premier League, La Liga, Serie A, Bundesliga, Ligue 1 — covering scores, fixtures, league tables, squads, player statistics, aggregated news, transfers, injuries, and a fixture calendar.

The product is judged on two things: whether the data is current, and whether pages appear instantly.

### Phase decomposition

| Phase | Contents | Status |
|---|---|---|
| **A** | Ingestion pipeline, rate limiting, canonical store | This spec |
| **B** | Public site: landing, scores, calendar, leagues, teams, players, news, transfers, search | This spec |
| **C** | Accounts, comments, reactions, followed teams | Later spec |
| **D** | Fantasy game | Later spec |

**Hard project constraint: no paid services, ever.** Every component sits inside a permanent free tier. Where a limit binds, the product accepts the limit rather than the invoice.

---

## 2. Data sources — verified, not assumed

Every claim below was tested against the live API on 2026-08-03. This section supersedes all vendor marketing and pricing-page claims, several of which proved wrong.

### 2.1 What was rejected, and why

**API-Football (api-sports.io) — rejected as a live source.** The free plan is documented as 100 requests/day, which we budgeted for in detail. The real blocker is different and fatal: the free plan **only serves seasons 2022–2024**. A request for the 2026 season returns:

> `"Free plans do not have access to this season, try from 2022 to 2024."`

It therefore cannot supply current-season live scores, injuries, transfers, or player statistics. The adapter is still written and tested (against recorded 2023 responses) so that a future paid key activates it by configuration alone — but nothing in phases A or B depends on it.

**TheSportsDB free key — rejected as a primary source.** The keyless tier is throttled to a degree that makes it unusable: a Premier League table request returned **5 rows instead of 20**, and upcoming fixtures returned **1 event**. Retained only as an optional source of event thumbnail imagery.

**ESPN RSS — rejected.** Its football feed returned **1 item**. Not a usable news source.

### 2.2 What was accepted

**football-data.org (free tier) — the backbone.** Far more capable than its own pricing page advertises. Verified working on the free key:

| Capability | Verified result |
|---|---|
| Fixtures, all 5 leagues | ✓ 380 PL matches for 2026-27, full season |
| Results with scores | ✓ 2025-26 returned 380 matches, 380 played, with full-time scores |
| League tables | ✓ full 20-row standings |
| **Squads with player bio** | ✓ Arsenal returned 29 players with name, position, date of birth, nationality |
| **Club crests** | ✓ `crests.football-data.org` |
| Historical seasons | ✓ 2025-26 complete |
| Top scorers | ✓ endpoint healthy (returns 0 while the season is unplayed) |

Its pricing page claims squads and scorers are paid-only. **They are not.** This was tested directly.

Rate limit confirmed from live response headers: `x-requests-available-minute: 9`, `X-RequestCounter-Reset: 60` — **10 requests/minute, ≈14,400/day.**

**Fantasy Premier League API (`fantasy.premierleague.com/api/`) — keyless, no auth, no documented limit.** Verified: 20 teams, **564 players**, 38 gameweeks, with per-player `minutes`, `goals_scored`, `assists`, `expected_goals`, `form`, and `photo`. Premier League only. This is the richest free player-statistics source available and it also becomes the natural data source for the phase D fantasy game.

**RSS — news, transfers, injuries.** Verified item counts: BBC Sport **71**, Guardian Football **61**, Sky Sports **20**.

### 2.3 Resulting source map

| Need | Source | Coverage |
|---|---|---|
| Fixtures, results, tables, crests | football-data.org | All 5 leagues |
| Squads (full current roster) | football-data.org | **PL, Bundesliga, Ligue 1 only** — La Liga and Serie A return an empty `squad` array for every club (verified: Barcelona, Inter both 0; see §2.4) |
| Historical (2025-26) | football-data.org | All 5 leagues |
| Top scorers / assisters (also the only player source for La Liga/Serie A) | football-data.org | All 5 leagues |
| Deep per-player statistics + photos | FPL API | **Premier League only** |
| News, transfers, injuries (as stories) | RSS (BBC, Guardian, Sky) | Global |

### 2.4 Two acknowledged gaps

**In-play live scores.** No free source provides true minute-by-minute in-play data. football-data.org serves scores on a delay of unknown length — unmeasurable today because no league in the free set had a match in progress. Mitigation: poll `/v4/matches` every 60 seconds (1,440 requests/day against a 14,400 ceiling — comfortably affordable) and display whatever freshness the source provides, with a visible "updated N seconds ago" stamp so latency is honest rather than hidden. **Actual latency is to be measured on 2026-08-16, the first matchday, and this section updated with the observed figure.**

**No squad data at all for La Liga and Serie A.** This is sharper than "per-player statistics outside the Premier League are thinner" — it was originally recorded that way and that framing understated the gap. `getSquad` (`GET /v4/teams/{id}`) returns an **empty `squad` array for every La Liga and Serie A club**, verified directly: Barcelona (fd_id 81) squad 0, Inter (fd_id 108) squad 0, while a Premier League club in the same call (Arsenal, fd_id 57) returns squad 29. Bundesliga and Ligue 1 clubs are unaffected and get full squads, same as the Premier League. The Task 9 backfill's squad phase therefore wrote **zero player rows** for La Liga's and Serie A's 23 clubs each, and every scorer-id lookup against those two leagues resolved to nothing — the exact failure this section originally warned readers to watch for, not a hypothetical.

The fix in place: the scorers endpoint (`GET /v4/competitions/{code}/scorers?season=YYYY&limit=100`) is the **only** free source of players for these two leagues, and it is now used as such — a `players` row is created directly from a scorer entry's embedded `player` object (bio: name, position, date of birth, nationality — position is null in practice for every observed entry so far; shirt number where the payload has one) whenever that player doesn't already exist, before writing `player_season_stats`. This means, concretely:

- **La Liga and Serie A players are limited to roughly the top 100 scorers per league per season** (the API's per-request cap), not full ~25-man squads across 20+ clubs. A player who has never scored or assisted in that competition's covered season(s) will not have a page at all.
- **Bundesliga and Ligue 1 get full current squads** (~18-25 players per club, all clubs) via `getSquad`, the same as the Premier League, *plus* any additional scorers this path surfaces.
- **Premier League** gets full squads from football-data.org and the complete depth/statistics set from the FPL API on top.

Phase B's player pages and team squad-list views must design for this asymmetry explicitly: a La Liga or Serie A club's squad page will show only the subset of its roster that has scored or assisted (typically a double-digit fraction of a real ~25-man squad), never a fabricated "full squad" — and copy on those pages should say so, rather than implying a gap that doesn't exist. Non-PL players (all four non-PL leagues) get bio and, where they appear in the league's top scorers, goals and assists; they do not get minutes, xG, or shot data, because no free source provides it. Premier League players get the complete set from the FPL API.

This asymmetry is displayed honestly: non-PL player pages show the statistics that exist and state plainly which are unavailable, rather than rendering empty charts or fabricated values. **No statistic is ever estimated, interpolated, or invented.**

---

## 3. Season timing and preseason mode

Verified against football-data.org on 2026-08-03:

| League | 2026-27 starts | Ends |
|---|---|---|
| La Liga | 2026-08-16 | 2027-05-30 |
| Premier League | 2026-08-21 | 2027-05-30 |
| Ligue 1 | 2026-08-22 | 2027-05-29 |
| Serie A | 2026-08-23 | 2027-05-30 |
| Bundesliga | 2026-08-28 | 2027-05-22 |

The build begins 13–25 days before kickoff. Every league sits at matchday 1 with no results and no table. The site must be correct and populated **before** any match is played.

**Preseason behaviour by surface:**

- **Player pages** — query 2026-27 stats; when a player has no minutes in the current season, fall back to 2025-26 and label the block with the season it describes. A player page must never render empty. This is permanent behaviour, not a temporary hack — it also covers new signings and January arrivals.
- **League tables** — no 2026-27 table exists until matchday 1 concludes. Show the final 2025-26 table, clearly labelled as last season, alongside a countdown to that league's first fixture.
- **Landing page** — the live-score strip has a preseason variant: a countdown to the next league to kick off, with the transfer and news feed promoted into the primary slot. August is the peak transfer window, so this is the richest content available at launch rather than a consolation.
- **Historical backfill** — 2025-26 final standings, all 380 results per league, and top scorers are ingested during preseason. This gives the site real content on day one and gives development real data to build against.

**Testing consequence:** the live path cannot be validated against real in-play matches before 2026-08-16. Recorded response snapshots are mandatory for it, and the match-window guard must be unit-tested against synthetic fixture states covering scheduled, in-play, paused, finished and postponed.

---

## 4. Architecture

```
football-data.org · FPL API · RSS feeds
        │
        │  GitHub Actions (cron)
        ▼
   Ingestion workers  ←──►  rate limiter
        │
        ▼
   Supabase Postgres  ── the only source pages read from
        │
        ▼
   Next.js App Router (server components) ──► Netlify CDN
```

**Invariant:** no third-party API call ever occurs on the request path of a page view. Users read Postgres, always. This is what makes pages fast and what keeps provider load flat regardless of traffic.

### Stack

- Next.js 15, App Router, TypeScript
- Tailwind CSS
- Supabase Postgres (also provides Auth and relational tables for phases C and D)
- Netlify — hosting and CDN only
- GitHub Actions — all scheduled ingestion
- Vitest (unit/integration), Playwright (E2E)

**Why ingestion is not on Netlify:** Netlify's free tier is credit-based — 300 credits/month, 15 credits per production deploy (≈20 deploys/month), and a 10-second function timeout. Batch ingestion does not fit that, and deploys are the scarce resource. GitHub Actions gives unlimited minutes on public repositories with no execution timeout.

**Netlify credit discipline:** work is verified locally and in CI; production deploys are batched, not made per-commit. Deploy previews are disabled for routine branches.

Supabase's free tier pauses after 7 days idle; the hourly cron keeps it active, so this never triggers.

---

## 5. Ingestion layer (Phase A)

### 5.1 Provider adapters — `lib/providers/`

One module per source, each behind a narrow typed interface, owning its own auth, pagination and response mapping. Nothing outside this directory sees a provider's raw response shape. Adapters return domain types (`Fixture`, `Standing`, `SquadMember`, …), never provider JSON.

| Module | Source | Provides |
|---|---|---|
| `footballData.ts` | football-data.org | fixtures, results, standings, squads, crests, scorers |
| `fpl.ts` | fantasy.premierleague.com | Premier League per-player statistics and photos |
| `rss.ts` | BBC, Guardian, Sky | news headlines |

No API-Football adapter is written. Its free plan cannot serve current seasons, so the code would be dead on arrival; the adapter interface exists so one can be added later if a paid key is ever acceptable, but building it now would be unused code.

### 5.2 Rate limiter — `lib/ingest/rateLimiter.ts`

football-data.org permits 10 requests/minute. Every outbound call passes through a token-bucket limiter that reads the live `x-requests-available-minute` response header and self-corrects, rather than relying on a fixed local count that can drift out of sync after retries.

This replaces the daily-quota budget ledger from the earlier draft: with ~14,400 requests/day available against a workload of roughly 1,600, the daily budget is no longer the binding constraint. **Requests-per-minute is.**

`ingest_budget` is retained purely as an observability record — requests consumed per provider per day, surfaced on `/status`.

### 5.3 Job scheduling — `lib/ingest/jobs.ts`

Jobs are **staleness-driven, not clock-driven**: each asks "what in the database is older than its freshness target?" and works that set. This is what makes them safe under GitHub Actions' best-effort cron, which can fire late or skip.

| Job | Freshness target | Cost |
|---|---|---|
| Live/recent matches | 60s during match windows | 1 req |
| Fixtures & results | 6h | 5 req |
| Standings | 1h | 5 req |
| Squads | 7d, weekly job | 98 req (one per club) |
| Top scorers | 1h, with core | 5 req |
| FPL player stats | 6h | 1 req (single bulk endpoint) |
| News (RSS) | 15min | 3 fetches, unmetered |

Total steady-state load is well under 2,000 requests/day against a 14,400 ceiling.

### 5.4 Match-window guard

The live job first queries the **database** (free) to determine whether any tracked fixture is currently in progress. If none is, it returns immediately without spending a request. Without this, 60-second polling costs 1,440 requests/day year-round; with it, that cost is only incurred while matches are actually being played — which during preseason is never.

### 5.5 Scheduled workers — `.github/workflows/`

Each workflow invokes a Node entrypoint under `scripts/ingest/` that connects to Supabase with the service role key.

| Workflow | Schedule | Work |
|---|---|---|
| `ingest-live.yml` | `*/5 * * * *` | Match-window guard, then in-play match refresh |
| `ingest-core.yml` | `0 * * * *` | Standings, fixtures, results, top scorers |
| `ingest-news.yml` | `*/15 * * * *` | RSS ingest, dedupe by content hash, classify by league/team |
| `ingest-players.yml` | `30 */6 * * *` | FPL player statistics; squad refresh when stale |
| `keepalive.yml` | `0 3 1 * *` | Monthly commit — prevents Actions disabling schedules after 60 days of repository inactivity |

Every workflow declares `workflow_dispatch` so any job can be run manually from the Actions tab. That is the primary debugging affordance for the pipeline.

**GitHub Actions caveats absorbed by design:** scheduled workflows are disabled after 60 days without a repository commit (hence `keepalive.yml`), and cron firing is best-effort and may be delayed (hence staleness-driven jobs). Five-minute cron is the platform minimum, which is why `ingest-live` runs at 5-minute granularity even though the rate limit would permit 60-second polling; the job itself re-polls in a short loop within a single invocation to achieve finer resolution during match windows.

---

## 6. Data model (Supabase Postgres)

```
leagues              id, fd_code, fd_id, slug, name, country, emblem_url,
                     current_season, season_start, season_end

teams                id, fd_id, league_id→leagues, slug, name, short_name, tla,
                     crest_url, venue, founded, club_colors

players              id, fd_id, fpl_id, team_id→teams, slug, name, position,
                     nationality, date_of_birth, photo_url

fixtures             id, fd_id, league_id, home_team_id, away_team_id,
                     kickoff_utc, status, matchday, home_goals, away_goals,
                     half_time_home, half_time_away, last_updated, updated_at

standings            league_id, team_id, season, position, played, won, drawn,
                     lost, goals_for, goals_against, goal_difference, points,
                     form, updated_at

player_season_stats  player_id, league_id, season, source, appearances, minutes,
                     goals, assists, expected_goals, yellow_cards, red_cards,
                     updated_at

news_items           id, source, title, summary, url, image_url, published_at,
                     league_id, team_ids[], content_hash

ingest_run           id, job, status, message, requests_used, started_at,
                     finished_at
ingest_budget        provider, day_utc, requests_used     -- observability only
```

`player_season_stats.source` records which provider supplied a row (`fpl` or `football-data`), so the UI can state exactly which statistics are available and which are not. Every user-facing table carries `updated_at` so pages can display data age. `news_items.content_hash` deduplicates the same story arriving from multiple feeds.

Indexes: `fixtures(kickoff_utc)`, `fixtures(status)` for the match-window guard, `standings(league_id, season, position)`, `news_items(published_at DESC)`, and pg_trgm indexes on `teams.name` and `players.name` for search.

Transfers and injuries have **no structured free source**. They are surfaced as classified news items from RSS (filtered on transfer and injury keywords, tagged to clubs and players by name match) rather than as structured records. The `/transfers` route is therefore a filtered news view, not a table of confirmed fees. It is labelled accordingly — reported, not confirmed.

---

## 7. Site (Phase B)

### 7.1 Routes

| Route | Contents |
|---|---|
| `/` | Trending news, score strip (preseason: countdown), next fixtures, fantasy slot |
| `/scores` | Live and recent results across all five leagues |
| `/calendar` | Month and week fixture views, league/club filters, `.ics` export |
| `/league/[slug]` | Table, fixtures, top scorers |
| `/team/[slug]` | Squad, form, fixtures, related news |
| `/player/[slug]` | Statistics (full for PL, bio + available figures elsewhere), photo, club |
| `/news` | Aggregated feed with league/club filters |
| `/transfers` | Transfer-classified news feed, labelled as reported |
| `/search` | Instant search across teams and players |
| `/status` | Pipeline health: last run per job, requests used, recent errors |

**Landing-page fantasy slot in phases A + B:** the layout reserves the slot and renders a real "Fantasy — coming soon" panel describing the game. Phase D replaces its contents without touching the landing layout.

**Search implementation:** a server route handler queries the pg_trgm indexes on `teams.name` and `players.name` and returns ranked JSON. Client input is debounced at 150ms. Results are prefetched on hover. No search index is held client-side.

### 7.2 Refresh behaviour

A hard requirement: refreshing a page must refresh *that page's* data, like a normal website — never reset to an app shell or lose the user's place.

- Every view is a real URL, server-rendered from Postgres.
- Per-route revalidation: scores 60s, league and team 15min, player 6h, news 5min.
- Live views additionally poll a lightweight JSON route handler and **patch only the changed values in place**. Scroll position, active filters and expanded panels survive.
- Because rendering reads Postgres and never a provider, a hard refresh is fast regardless of provider state.

### 7.3 Visual direction — "Broadcast"

Dark-first, high contrast, matchday register. A light theme ships as a considered secondary.

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

Accessibility: all text meets WCAG AA against its background; live state is never signalled by colour alone (dot plus minute label); every interactive element is keyboard reachable with a visible focus ring.

### 7.4 Imagery

Real club crests from `crests.football-data.org` and real player photos from the FPL asset CDN, URLs stored in the database and served via `next/image` with those hosts whitelisted. Every image has a club-coloured monogram fallback so a missing asset never renders as a broken icon. **No generated imagery anywhere in the product.**

Player photography exists for Premier League players only. Elsewhere the monogram fallback is the normal state, designed to look deliberate rather than broken.

---

## 8. Failure handling

Ingestion failure must never break a page.

- Pages render last-known-good data from Postgres with a visible "updated N minutes ago" stamp — staleness is shown, not hidden.
- Provider errors are written to `ingest_run` with job, message and requests consumed.
- A `429` or an `x-requests-available-minute` of 0 triggers exponential backoff; the limiter self-corrects from the response header.
- `/status` reports last successful run per job, requests consumed, and recent errors. A scheduled pipeline that cannot be observed cannot be operated.

---

## 9. Testing

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | Adapters against recorded JSON snapshots; rate limiter including header self-correction; staleness selection; match-window guard across all fixture states |
| Integration | Vitest + local Supabase | Ingestion → database writes, upserts, dedupe |
| E2E | Playwright | Landing renders with data; hard refresh preserves page and filters; live patch updates a score without navigation; player page never renders empty |

**No live provider calls in CI.** All adapter tests run against committed response snapshots captured from the real endpoints.

---

## 10. External accounts

All created and verified on 2026-08-03:

- **GitHub** — public repository (public is what makes Actions minutes unlimited)
- **football-data.org** — free key ✓ verified
- **Supabase** — project ✓ verified (service_role 200, anon JWT valid to 2036)
- **Netlify** — site, connected to the repository (deferred until there is something to deploy)
- **api-sports.io** — key held but dormant; unusable for current seasons on the free plan

FPL, RSS and crest CDNs require no key.

Secrets live in three places: `.env.local` for local development (gitignored), **GitHub repository secrets** for ingestion workflows, and **Netlify environment variables** for page rendering. The service role key goes only in GitHub secrets and Netlify — never in client code, never committed.

---

## 11. Definition of done for A + B

- All five leagues ingesting fixtures, results, tables, squads and news on schedule.
- 2025-26 historical season backfilled so no page is empty before kickoff.
- FPL player statistics ingesting for all 564 Premier League players.
- Sustained request rate staying under 10/minute, verified on `/status`.
- All ten routes rendering real data with real crests.
- Player pages never empty — current-season stats where they exist, labelled prior-season fallback where they don't, and an explicit statement of which statistics are unavailable for non-PL players.
- Hard refresh on any route re-renders that route with fresh data and preserves filters.
- Light and dark themes both meeting WCAG AA.
- Unit, integration and E2E suites passing with no live provider calls.
- Live-score latency measured on 2026-08-16 and §2.4 updated with the observed figure.
