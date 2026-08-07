-- 0007_fantasy_player_season.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The picker needs to know two things about every player that nothing in
-- this database records: what they cost, and which of FPL's four positions
-- they occupy.
--
-- THE PRICE IS THE GAME
-- ---------------------
-- Without a budget, every manager picks the same fifteen best players and
-- the league is a fifteen-way tie. Scarcity is the only reason a choice is a
-- choice, so `price_tenths` is not a decoration on the picker — it is the
-- rule that makes the picker worth using. FPL publishes `now_cost` in tenths
-- of a million (125 = £12.5m) and it moves during a season as managers buy
-- and sell, so it is stored here and refreshed by every fantasy ingest run.
--
-- WHY NOT A COLUMN ON `players`
-- ------------------------------
-- `players` is the identity table both providers write to, and
-- `scripts/ingest/players.ts` reconciles those two write paths with some
-- care (see the comments there). A price is neither provider-neutral nor
-- permanent: it is FPL's, it is per-season, and it changes weekly. Putting
-- it on `players` would mean touching the identity merge path to write a
-- number that has nothing to do with identity. A separate table keyed on
-- (player_id, season) says what it is and is written by exactly one job.
--
-- WHY FPL'S POSITION AND NOT `players.position`
-- ----------------------------------------------
-- `players.position` is whichever provider wrote the row last, and
-- football-data's vocabulary is finer-grained ("Defensive Midfield",
-- "Left-Back"). The fantasy shape rules — two keepers, five defenders, five
-- midfielders, three forwards — are FPL's rules over FPL's classification,
-- and deriving them from a different provider's labels would reject squads
-- FPL itself would accept. This column stores `element_type` as the code the
-- rules actually reason in.
--
-- The check constraint is deliberate: an unrecognised position is a bug in
-- ingest, and letting one through would make `selectionErrors` silently
-- ignore a player rather than count them.
--
-- PUBLIC READ
-- -----------
-- Prices and positions are published FPL data. No user information here —
-- squads and picks are 0008, with per-user RLS.
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0006). The project owner must do this by hand.
--
-- Until it is applied the picker has no player pool and says so; nothing
-- else on the site reads this table.
--
-- IDEMPOTENCY
-- -----------
-- Every statement is `if not exists` / `drop ... if exists` before create.

create table if not exists fantasy_player_season (
  player_id     bigint  not null references players(id) on delete cascade,
  season        integer not null,
  -- FPL's element_type as a code. See the note above on why this is not
  -- read from players.position.
  position      text    not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  -- FPL's now_cost: tenths of a million. Not null, because a player with no
  -- price is not pickable and does not belong in the pool at all — the
  -- ingest job skips them rather than storing a guess.
  price_tenths  integer not null check (price_tenths > 0),
  updated_at    timestamptz not null default now(),
  primary key (player_id, season)
);

-- The picker's own query: one season's pool, filtered by position.
create index if not exists fantasy_pool_season_position_idx
  on fantasy_player_season (season, position);

grant all privileges on fantasy_player_season to service_role;
grant select on fantasy_player_season to anon, authenticated;

alter table fantasy_player_season enable row level security;
drop policy if exists fantasy_player_season_select_all on fantasy_player_season;
create policy fantasy_player_season_select_all on fantasy_player_season
  for select to anon, authenticated using (true);
