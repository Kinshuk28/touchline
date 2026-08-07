# Touchline — Fantasy (Phase C)

**Date:** 2026-08-07
**Status:** Option A chosen. Scoring, gameweek ingest, magic-link auth and the squad
picker are built. Leagues and transfers are not.
**Scope:** a new writable surface. Everything shipped so far is read-only.

---

## What the site currently promises

The Fantasy teaser on the landing page says:

> Pick a squad across the Premier League, La Liga, Serie A, the Bundesliga and Ligue 1,
> score it on real results as they land, and run a league against your friends.

Three claims: **five leagues**, **player picks**, **scored on real results**. The data
audit below says we can honestly deliver at most two of the three today, and the
teaser copy has to change to match whichever we build.

---

## Data audit: what can actually be scored

| Source | Coverage | Granularity | Player-level? |
|---|---|---|---|
| football-data.org (free tier) | all five leagues | fixtures, results, standings | scorers only — **season totals**, no per-match events |
| FPL `bootstrap-static` | Premier League only | **season totals** per player | yes |
| FPL `element-summary/{id}` | Premier League only | **per gameweek** per player | yes — not currently ingested |
| FPL `event/{id}/live` | Premier League only | **per gameweek**, all players at once | yes — not currently ingested |

`player_season_stats` holds season aggregates from both sources. There is **no
per-match player data in this database at all**, and no free source of it for La Liga,
Serie A, the Bundesliga or Ligue 1.

That is the whole problem. A fantasy game is scored per matchday; season totals cannot
be differenced reliably (an ingest gap silently becomes a zero-point week, and a
correction upstream becomes a negative one).

---

## The decision

**Option A — Premier League player fantasy.** Pick 11 PL players, scored per gameweek
from FPL's `event/{id}/live`. Real per-match points: goals, assists, minutes, clean
sheets, cards, bonus. This is the game people expect, scored correctly, on one league.
Requires a new ingest job (one request per gameweek, well inside the budget) and the
teaser copy narrowed to the Premier League.

**Option B — five-league club fantasy.** Pick 5 clubs across the five leagues, scored on
results we already store for every competition: win/draw, goals scored, clean sheet,
margin. No new provider, no new ingest, works from day one across all five leagues, and
every number is already on the site. It is a smaller game than people picture when they
read "fantasy", but it is the honest five-league one.

**Option C — wait.** Per-match player events for five leagues means a paid provider.

**Recommendation: A.** "Fantasy football" means picking players and watching their
goals score you points; Option B is a different, quieter game that would disappoint
anyone arriving from the teaser. Narrowing to one league is a smaller broken promise
than a five-league game whose points are derived from season-total arithmetic — and the
site already says which competitions it covers everywhere else, so scoping the game is
consistent rather than apologetic.

If A ships well, B becomes a natural second mode ("club fantasy") for the other four
leagues rather than a compromise.

---

## What Option A needs (the part that is not football)

This is the first **writable** surface in the project, and it breaks two standing rules
deliberately and carefully:

1. **The site reads with a SELECT-only anon key.** Squads and leagues are user writes.
   Supabase Auth plus row-level security is the intended path: a signed-in user may
   insert and update only rows whose `user_id` is their own, enforced in the database
   rather than in application code. The service-role key stays out of the rendering path
   exactly as it is today.
2. **Every page is currently server-rendered from stored data with no client state.**
   Squad picking is inherently interactive. It should still submit through a server
   action and store server-side; the pick UI is the one place client state is warranted.

New tables (sketch, to be specified properly before implementation):

- `fantasy_squad` — one per user per season: id, user_id, name, created_at.
- `fantasy_pick` — squad_id, player_id, slot, active_from_gameweek. Immutable history
  rather than mutation, so a past gameweek's score can always be recomputed from what
  was actually picked at the time.
- `fantasy_gameweek_points` — player_id, gameweek, points, breakdown. Written by ingest,
  never by a user.
- `fantasy_league` / `fantasy_league_member` — friends' leagues.

Scoring lives in `lib/fantasy/scoring.ts` as a pure function over a gameweek's stat line,
unit-tested against published FPL rules, so the rules are readable in one place and a
scoring change is a diff rather than an archaeology exercise.

---

## Risks worth stating before anyone writes code

- **Auth is a product decision, not a technical one.** Email magic links are the least
  friction; anything social means third-party accounts and a privacy surface this site
  currently does not have (one functional cookie, no tracking).
- **Writes cost.** Every ingest run currently costs a Netlify build only when the site
  redeploys. User writes are continuous database traffic on a free Supabase tier.
- **A fantasy game is a commitment.** It has a season, and abandoning it mid-season is
  worse than never shipping it. The first version should cover one full season's rules
  end to end, not a picker with scoring "coming later".

---

## Suggested first slice (once the option is chosen)

1. `lib/fantasy/scoring.ts` + tests — pure, no database, no auth. Provable before
   anything else exists.
2. The gameweek ingest job that populates `fantasy_gameweek_points`.
3. Auth, then the picker, then leagues.

Steps 1 and 2 are independently useful and carry no product risk: they turn "we could
score a fantasy game" from an assumption into a demonstrated fact.

---

## Built (steps 1 and 2)

| Piece | Where | What it decides |
|---|---|---|
| Squad scoring | `lib/fantasy/scoring.ts` | who counts, who doubles, auto-subs, pending |
| Gameweek feed | `FplClient.getGameweekLive` | one request → every player's stat line |
| Gameweek calendar | `FplClient.getBootstrap().events` | `finished` vs `data_checked` |
| What to fetch | `lib/ingest/gameweekSchedule.ts` | started and not settled, oldest first |
| Storage | `supabase/migrations/0006_fantasy_gameweek_points.sql` | one row per player per gameweek |
| The job | `scripts/ingest/fantasy.ts`, `.github/workflows/ingest-fantasy.yml` | two-hourly |

Three decisions in there are worth keeping in view, because each is a place the obvious
implementation is wrong:

**Points are FPL's, not ours.** `points` stores their published `total_points`
unchanged. Their rules change between seasons — defensive contribution points arrived in
2025-26 — so a reimplementation would be a second source of truth drifting from the
first without anyone noticing. The component stats are stored so a score can be
*explained* on a page, never so it can be re-derived.

**Unknown is not zero.** A player's minutes are "played", "blanked", or "not published
yet", and the third is not the second. Auto-subs fire only for a starter known to have
blanked; the captaincy moves only when the captain blanked *and* the vice played;
anything unpublished is left alone and counted in `pending`. Collapsing the two would
make a live total substitute players on and then off again as the gameweek finished.

**A finished gameweek is not a settled one.** Bonus points and corrections land after the
final whistle, and `data_checked` is FPL's own flag for "settled". The job re-fetches
until that flag arrives, and stores it as `is_final` so a page can say "provisional"
honestly. It also re-fetches any *earlier* gameweek that is not stored settled, which is
how a failed run repairs itself — a rule that only fetched the current gameweek would
lose that week permanently.

### Before this runs

`supabase/migrations/0006_fantasy_gameweek_points.sql` has not been applied. Until it is,
the job fails its run with a clear message and the site is unaffected — no read path
touches the table yet. `scripts/verify-schema.ts` reports it as pending rather than
missing.

---

## Built (auth and the picker)

Magic links, chosen over social sign-in for the reason the Risks section gives: this site
holds one functional cookie and no tracking, and a third-party account would be a whole
new privacy surface for a football game. There is no password anywhere in the system —
nothing to store, leak, reuse or reset. The entire account is an email address.

| Piece | Where |
|---|---|
| Session cookies, user-scoped client | `lib/auth/session.ts`, `lib/auth/cookies.ts` |
| Token claims (never authorisation) | `lib/auth/jwt.ts` |
| Refresh on the way in | `proxy.ts` |
| Sign in / confirm / sign out | `app/fantasy/sign-in`, `app/auth/confirm`, `lib/auth/actions.ts` |
| Squad rules | `lib/fantasy/squadRules.ts` |
| Deadline rule | `lib/fantasy/gameweekWindow.ts` |
| Player pool (price, position) | `supabase/migrations/0007`, refreshed by the fantasy job |
| Squads and picks | `supabase/migrations/0008`, `lib/fantasy/squadStore.ts` |
| The picker | `components/SquadPicker.tsx`, `lib/fantasy/pickerActions.ts` |

### No new dependency

`@supabase/ssr` is the obvious way to do cookie sessions in the App Router, and it is a
new dependency. What it actually provides is cookie plumbing plus a PKCE verifier store,
and the magic-link flow here needs neither: `verifyOtp` exchanges a token hash for a
session in one server-side call. The plumbing is about a hundred lines in
`lib/auth/session.ts` instead.

### The email template, and why sign-in works without changing it

The good path is a link carrying `token_hash`, redeemed entirely server-side so the
session never touches the browser's URL. That needs one template change in the Supabase
dashboard (below). Supabase's **stock** template instead puts the tokens in the URL
fragment, which no server can read — so `app/auth/confirm` redirects those to a small
client component (`components/SessionBridge.tsx`) that hands them to `/auth/session` and
clears the address bar.

Supporting both means sign-in works on a project with nothing configured beyond the
redirect allow-list, and gets quietly better when the template is updated. Shipping only
the good path would have failed with "invalid link" on a fresh project and looked like a
bug in this code.

### The write posture

This is the first time anything other than `service_role` writes. It is narrowed as far
as it goes: `anon` gets **nothing at all** on `fantasy_squad` and `fantasy_pick` — not
even SELECT — and `authenticated` gets writes scoped by RLS to `auth.uid() = user_id`,
with `with check` as well as `using` so a row cannot be reassigned to someone else on
update. Enforced in Postgres, because the anon key ships to the browser and anyone
holding it can skip every line of TypeScript in this repository.

### The budget is the game

Without it every manager picks the same fifteen best players and the league is a tie.
Prices come from FPL's `now_cost`, stored per season in `fantasy_player_season` and
refreshed by the same ingest run that fetches the gameweeks. £100.0m, 2/5/5/3, at most
three from any one club, and a legal formation — all in `lib/fantasy/squadRules.ts`,
used by the picker as you click *and* re-checked by the server action against a pool read
from the database. The client-side check is a courtesy; it is never the control.

### Changing a side is a new generation, not an edit

`fantasy_pick.active_from_gameweek` means a save writes a new generation and leaves older
ones alone. Without it, changing your side in gameweek 12 would silently rewrite what you
were credited with in gameweek 3 — the scorer reads whatever picks exist now, so mutation
is retroactive. And a save only ever affects a gameweek whose deadline has not passed
(`lib/fantasy/gameweekWindow.ts`); otherwise you could watch a goal go in and then buy the
scorer.

### Owner setup, in order

Nothing below can be done from code — all of it lives in the Supabase dashboard, and
until it is done `/fantasy` says "not ready yet" rather than failing.

1. **Apply the migrations**, in order: `0006_fantasy_gameweek_points.sql`,
   `0007_fantasy_player_season.sql`, `0008_fantasy_squads.sql`. SQL Editor → New query →
   paste → Run. `npx tsx scripts/verify-schema.ts` lists which are still pending.

2. **Allow the redirect.** Authentication → URL Configuration → Redirect URLs, add
   `https://football-touchline.netlify.app/auth/confirm`. Supabase refuses any
   `emailRedirectTo` outside this list, which is also what stops a forged Host header
   pointing a sign-in link somewhere else.

3. **Run the fantasy ingest once** (Actions → ingest-fantasy → Run workflow) so the
   player pool has prices. Without it the picker has nothing to pick from and says so.

4. **Optional, and worth doing:** Authentication → Email Templates → Magic Link, change
   the link to

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
   ```

   This moves sign-in entirely server-side. Sign-in works without it — see the note above
   on the fragment fallback — but with it the session never appears in a URL.

### Still open

- **Leagues against friends**, which the teaser no longer promises but the game still
  wants.
- **Transfers between gameweeks** — the schema supports it (generations), the UI does
  not; today a save replaces the whole side.
- **Chips** (wildcard, triple captain). Deliberately absent: each is a rule, and rules
  belong in `squadRules.ts` with tests, not bolted onto a picker.
- **`saveSquad` is two statements, not a transaction.** PostgREST has no cross-request
  transaction; a failure between the delete and the insert leaves the generation empty,
  which the picker reads as "no squad yet" and offers to rebuild. Recoverable, but a
  Postgres function would make it atomic.
