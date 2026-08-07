-- 0008_fantasy_squads.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- This is the first user data this project has ever stored, and the first
-- time anything other than `service_role` is allowed to write. Everything
-- before it was public football data with a read-only anon key. Read the
-- posture section below before changing anything here.
--
-- Three tables:
--   * `fantasy_gameweek` -- the season calendar. Public, written by ingest.
--   * `fantasy_squad`    -- one squad per person per season.
--   * `fantasy_pick`     -- the fifteen players in it, with history.
--
--
-- THE WRITE POSTURE (this is the load-bearing part)
-- --------------------------------------------------
-- 0002 gave `anon` and `authenticated` SELECT and nothing else, on every
-- table, enforced twice -- by the absence of a write grant, and by RLS. That
-- rule holds everywhere except the two user tables below, and it is narrowed
-- as far as it can go:
--
--   * `anon` gets **nothing at all** on `fantasy_squad` and `fantasy_pick` --
--     not even SELECT. A signed-out visitor cannot read anyone's squad. The
--     anon key ships to the browser; anybody who loads the site holds it.
--   * `authenticated` gets INSERT/UPDATE/DELETE, and every policy is scoped
--     to `auth.uid() = user_id`. A signed-in user can read and write their
--     own rows and is invisible to everyone else's.
--   * `fantasy_pick` has no `user_id` of its own; its policies reach through
--     `squad_id` to `fantasy_squad.user_id`, so a pick is reachable exactly
--     when its squad is.
--
-- Enforced in the database, not in application code, because the anon key is
-- public: anyone can craft a PostgREST request with it and skip every line of
-- TypeScript this project contains. The policies below are the actual
-- security boundary. `service_role` still bypasses RLS and still never
-- appears in anything the site renders (lib/site/supabase.ts).
--
-- `with check` as well as `using` on every write policy: `using` decides
-- which rows you may touch, `with check` decides what you may leave behind.
-- Without the second, a user could take a row they own and reassign its
-- `user_id` to someone else.
--
--
-- WHY PICKS HAVE HISTORY
-- ----------------------
-- `fantasy_pick.active_from_gameweek` makes a save a new generation rather
-- than an edit. Without it, changing your side in gameweek 12 would silently
-- rewrite what you were credited with in gameweek 3 -- the scorer reads
-- whatever picks exist now, so mutation is retroactive. A season-long game
-- whose past scores move is not a game.
--
-- Reading is "the newest generation at or before the gameweek being scored".
-- A whole season is at most 15 x 38 rows per squad, so this is deliberately
-- resolved in one query and grouped in code rather than with a window
-- function in a view.
--
--
-- ONE SQUAD PER SEASON, FOR NOW
-- ------------------------------
-- The unique constraint on (user_id, season) is a product decision written
-- into the schema: one side, managed all year, like the game it is modelled
-- on. Lifting it later is an easy migration; discovering that half the rows
-- are abandoned second attempts is not.
--
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0007). The project owner must do this by hand.
--
-- Until it is applied, /fantasy renders a plain "not set up yet" panel
-- instead of failing, and the rest of the site is untouched.
--
-- IDEMPOTENCY
-- -----------
-- `if not exists` / `drop ... if exists` before create throughout.


-- 1. THE CALENDAR ----------------------------------------------------------
-- Written by scripts/ingest/fantasy.ts from FPL's `events`. The picker needs
-- it to say which gameweek a save takes effect from, and to show a deadline;
-- deriving either from the points table would mean inferring a schedule from
-- the presence of rows.

create table if not exists fantasy_gameweek (
  season        integer not null,
  gameweek      integer not null,
  name          text    not null,
  deadline_utc  timestamptz,
  -- FPL's own flags, kept separate because they mean different things:
  -- `finished` is "the last match ended", `is_final` is `data_checked`,
  -- "the points are settled". See supabase/migrations/0006.
  finished      boolean not null default false,
  is_final      boolean not null default false,
  is_current    boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (season, gameweek)
);

grant all privileges on fantasy_gameweek to service_role;
grant select on fantasy_gameweek to anon, authenticated;

alter table fantasy_gameweek enable row level security;
drop policy if exists fantasy_gameweek_select_all on fantasy_gameweek;
create policy fantasy_gameweek_select_all on fantasy_gameweek
  for select to anon, authenticated using (true);


-- 2. SQUADS ----------------------------------------------------------------

create table if not exists fantasy_squad (
  id          uuid primary key default gen_random_uuid(),
  -- `on delete cascade` is the deletion story: removing the auth user takes
  -- the squad and (through fantasy_pick's own cascade) every pick with it.
  -- There is no other personal data to erase.
  user_id     uuid    not null references auth.users(id) on delete cascade,
  season      integer not null,
  name        text    not null check (length(trim(name)) between 1 and 40),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, season)
);

create index if not exists fantasy_squad_user_idx on fantasy_squad (user_id);

-- Note what is NOT granted: anon gets nothing on this table, so a signed-out
-- request cannot read a single row even with the public anon key.
grant all privileges on fantasy_squad to service_role;
grant select, insert, update, delete on fantasy_squad to authenticated;

alter table fantasy_squad enable row level security;

drop policy if exists fantasy_squad_own_select on fantasy_squad;
create policy fantasy_squad_own_select on fantasy_squad
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists fantasy_squad_own_insert on fantasy_squad;
create policy fantasy_squad_own_insert on fantasy_squad
  for insert to authenticated with check (auth.uid() = user_id);

-- `with check` as well as `using`: without it, a user could update a row they
-- own and set `user_id` to somebody else's.
drop policy if exists fantasy_squad_own_update on fantasy_squad;
create policy fantasy_squad_own_update on fantasy_squad
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists fantasy_squad_own_delete on fantasy_squad;
create policy fantasy_squad_own_delete on fantasy_squad
  for delete to authenticated using (auth.uid() = user_id);


-- 3. PICKS -----------------------------------------------------------------

create table if not exists fantasy_pick (
  squad_id              uuid    not null references fantasy_squad(id) on delete cascade,
  -- The gameweek this generation of picks takes effect from. See the note on
  -- history above: a save writes a new generation, it never edits an old one.
  active_from_gameweek  integer not null,
  -- 1-11 start, 12-15 bench in substitution order. The scorer reads this
  -- range directly (lib/fantasy/scoring.ts), so the constraint is not
  -- cosmetic.
  slot                  integer not null check (slot between 1 and 15),
  player_id             bigint  not null references players(id) on delete restrict,
  is_captain            boolean not null default false,
  is_vice_captain       boolean not null default false,
  created_at            timestamptz not null default now(),
  primary key (squad_id, active_from_gameweek, slot),
  -- No player twice in the same generation. The picker checks this too, but
  -- the picker is not what enforces it.
  unique (squad_id, active_from_gameweek, player_id)
);

create index if not exists fantasy_pick_squad_idx on fantasy_pick (squad_id, active_from_gameweek);

grant all privileges on fantasy_pick to service_role;
grant select, insert, update, delete on fantasy_pick to authenticated;

alter table fantasy_pick enable row level security;

-- A pick carries no `user_id`; it belongs to whoever owns its squad. Each
-- policy reaches through `squad_id` to answer that, so a pick is reachable
-- exactly when its squad is and the two can never disagree.
drop policy if exists fantasy_pick_own_select on fantasy_pick;
create policy fantasy_pick_own_select on fantasy_pick
  for select to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_pick_own_insert on fantasy_pick;
create policy fantasy_pick_own_insert on fantasy_pick
  for insert to authenticated
  with check (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_pick_own_update on fantasy_pick;
create policy fantasy_pick_own_update on fantasy_pick
  for update to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()))
  with check (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_pick_own_delete on fantasy_pick;
create policy fantasy_pick_own_delete on fantasy_pick
  for delete to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));
