# Touchline — Fantasy (Phase C)

**Date:** 2026-08-07
**Status:** Option A chosen and built end to end — scoring, gameweek ingest, magic-link
auth, the squad picker, friends' leagues, transfers and chips.
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

2. **Set the Site URL and allow the redirect.** Authentication → URL Configuration has two
   separate fields — both matter, and missing either produces the same symptom (a magic
   link that dead-ends on `localhost:3000`):
   - **Site URL**: `https://football-touchline.netlify.app`. This defaults to
     `http://localhost:3000` on every new project and is where Supabase's own hosted
     `/auth/v1/verify` endpoint sends a browser when a token fails to verify — before the
     request ever reaches this app, and regardless of what `emailRedirectTo` was set to on
     the request that sent the email. Leaving this at its default is why a failed or
     already-used link lands on a dead `localhost:3000` in production.
   - **Redirect URLs**: add `https://football-touchline.netlify.app/auth/confirm`.
     Supabase refuses any `emailRedirectTo` outside this list on the *success* path, which
     is also what stops a forged Host header pointing a sign-in link somewhere else.

3. **Run the fantasy ingest once** (Actions → ingest-fantasy → Run workflow) so the
   player pool has prices. Without it the picker has nothing to pick from and says so.

4. **Optional, and worth doing:** Authentication → Email Templates → Magic Link, change
   the link to

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
   ```

   This moves sign-in entirely server-side. Sign-in works without it — see the note above
   on the fragment fallback — but with it the session never appears in a URL.

5. **Optional: turn on Google sign-in.** The site links straight to Supabase's own
   `/auth/v1/authorize?provider=google` endpoint (`lib/auth/actions.ts#googleSignInHref`),
   which does nothing until the provider is configured — until then the button redirects
   to a Supabase error page rather than failing silently.
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create
     an OAuth 2.0 Client ID (type: Web application). Authorized redirect URI:
     `<SUPABASE_URL>/auth/v1/callback` (the project's API URL, from step 1's `.env`, not
     this site's domain).
   - In the Supabase dashboard, Authentication → Providers → Google: paste the Client ID
     and Client Secret from the step above, and enable the provider.
   - No code change and no redeploy needed either way — the link is already live, it just
     errors until the provider is turned on.

---

## Built (leagues)

| Piece | Where |
|---|---|
| Season scoring across generations | `lib/fantasy/standings.ts` |
| Tables, memberships, join codes | `supabase/migrations/0009_fantasy_leagues.sql` |
| Reads and writes | `lib/fantasy/leagueStore.ts`, `lib/fantasy/leagueActions.ts` |
| Pages | `app/fantasy/leagues`, `app/fantasy/leagues/[id]` |

### The problem leagues create

0008 says a squad is visible only to `auth.uid() = user_id`. That is the right default and
it makes a league table impossible — showing what a rival scored means reading their
picks. So 0009 widens the door by exactly the width of a league:

- **`fantasy_squad`** becomes readable to anyone sharing a league with its owner. A squad
  row is a name and a season.
- **`fantasy_pick`** becomes readable to league-mates **only once that generation's own
  deadline has passed**. A fantasy game where you can read your opponents' teams before
  kick-off is a game where everyone picks the same eleven. Keying the test to the
  generation's gameweek rather than to "now" is what lets a table recompute history while
  keeping a side picked for next week private.
- Nothing else changes. Writes are still own-rows-only; `anon` still gets nothing.

### Three security-definer functions, and why

The obvious membership policy — "you can see members of leagues you are a member of" —
reads `fantasy_league_member` from inside `fantasy_league_member`'s own policy, and
Postgres reports infinite recursion at query time rather than at migration time. It is a
well-worn Supabase footgun. `fantasy_leagues_for` and `fantasy_shares_league` run as their
owner and so do not re-enter RLS, breaking the cycle at exactly one point. Each is
`set search_path = public`, and each is revoked from `public` and granted only to
`authenticated`.

`fantasy_join_league(code)` is the third, for a different reason: resolving a code means
reading a league you are not yet in, and any policy permitting that also permits
enumerating every league on the site. `authenticated` holds **no INSERT** on
`fantasy_league_member` at all — the only ways in are that function and the trigger that
makes a league's creator its first member.

A join code is therefore a bearer credential and is sized like one: eight characters from
a 30-symbol alphabet with the ambiguous glyphs (0/O, 1/I/L, U) removed.

### Scoring a season, not a gameweek

`scoreSeason` scores gameweek 3 against the side that was picked for gameweek 3. Scoring
every week against the current squad would make a manager's history rewrite itself on every
change — and would reward changing a side after seeing the results. A gameweek with no
generation in force is skipped, not scored zero: a manager who joined in October was not
playing in August, and that is a different fact from playing badly.

---

## Built (transfers)

| Piece | Where |
|---|---|
| The rules | `lib/fantasy/transfers.ts` |
| Purchase prices, per-gameweek records | `supabase/migrations/0010_fantasy_transfers.sql` |
| Counting and charging on save | `lib/fantasy/pickerActions.ts` |
| Deducting from a season | `lib/fantasy/standings.ts` |

One free transfer a gameweek, unused ones banking to five, four points for anything
beyond. Three decisions in there are worth keeping in view.

**A squad is valued at what it cost, not at today's list price.** FPL prices move all
season, so charging a stored squad today's prices would push a manager whose players
*improved* over the budget and force them to sell one — punished for picking well. So
`fantasy_pick.price_tenths` records what each player cost when bought: you pay today's
price and get your money back when you sell. That is deliberately not FPL's rule (they
split the difference on price rises, so squad values drift upward); theirs is a small
economy of its own, ours is a fixed budget. A different game, honestly described, rather
than a half-built version of theirs.

**The cost is stored, not derived.** Recomputing a past gameweek's hit from the pick
history would give a different answer the moment the rules were tuned, silently rewriting
finished seasons. `fantasy_squad_gameweek` holds what actually happened.

**Transfers are counted against the side that was locked in.** Not against the last save.
Diffing against the pending generation would let a manager save three changes, then three
more, and be charged for three — each save comparing against the one before it rather
than against the side they started the week with. Counting from the previous gameweek's
side every time is also what makes changing your mind before the deadline free.

---

## Built (chips)

| Piece | Where |
|---|---|
| The four chips and when each may be played | `lib/fantasy/chips.ts` |
| Triple Captain, Bench Boost | `ScoreOptions` in `lib/fantasy/scoring.ts` |
| Free Hit's one-week side | `generationFor` in `lib/fantasy/standings.ts` |
| Wildcard / Free Hit and the transfer bank | `lib/fantasy/transfers.ts` |
| Storage | `supabase/migrations/0011_fantasy_chips.sql` |

Each chip changes exactly one thing, and each of those things was already a parameter:

- **Wildcard** — transfers are free this week.
- **Free Hit** — transfers are free *and* the side lasts one gameweek.
- **Triple Captain** — the captain's multiplier is 3.
- **Bench Boost** — all fifteen score.

Which is why the migration is one column. The rules are code; the database only records
which chip was played and when.

**Free Hit is the only chip that changes what a stored squad means.** A generation played
under it is skipped for every gameweek but its own, so the week after, the squad you had
comes back. Letting the borrowed side persist would turn a Free Hit into a Wildcard — a
different chip the manager chose not to play. The same rule sets the transfer baseline the
following week: counting changes against the borrowed eleven would bill a manager for
giving back a team they were never keeping.

**A wildcard does not spend banked transfers.** FPL's rule, and the one that makes the
chip feel like a gift rather than a trade — twelve transfers on a wildcard in gameweek 8
still leaves whatever was saved for gameweek 9.

**Bench Boost makes no substitutions.** A substitution replaces a starter who did not
play with a bench player who did; when the bench is already scoring, substituting would
count somebody twice.

**One thing is deliberately *not* enforced in the database.** Ownership rules are, because
they protect one user from another and must hold against a crafted request. The
once-a-season and one-per-half chip budgets are checked in the server action instead: they
are game rules a manager can only break against themselves, and expressing them as
triggers would put a second copy of `chips.ts` in SQL.

### Still open

Nothing from the original spec. Natural next steps if the game finds an audience: a
gameweek-by-gameweek history page, cup competitions inside a league, and Option B's
five-league club fantasy as a second mode.
- **`saveSquad` is two statements, not a transaction.** PostgREST has no cross-request
  transaction; a failure between the delete and the insert leaves the generation empty,
  which the picker reads as "no squad yet" and offers to rebuild. Recoverable, but a
  Postgres function would make it atomic.
