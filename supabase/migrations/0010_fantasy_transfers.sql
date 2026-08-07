-- 0010_fantasy_transfers.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Until now a save replaced a whole side. That is right for a first pick and
-- wrong for every one after it: a fantasy season is a squad you keep and
-- adjust, and the adjusting is most of the game. Making it a game rather than
-- a shopping trip needs two things this schema does not yet hold.
--
--
-- 1. WHAT A SQUAD COST, NOT WHAT IT WOULD COST TODAY
-- ---------------------------------------------------
-- `fantasy_player_season.price_tenths` is refreshed on every ingest run,
-- because FPL prices move all season as managers buy and sell. Valuing a
-- stored squad at today's prices therefore has an ugly consequence: a manager
-- whose players *improved* — and so got more expensive — would be pushed over
-- the budget and forced to sell one. Being punished for picking well is the
-- opposite of the intended game.
--
-- So `fantasy_pick.price_tenths` records what each player cost **at the moment
-- they were bought**. A squad is valued at what it cost, the £100m cap never
-- moves, and selling refunds exactly what was paid. Explaining it takes one
-- sentence — you pay today's price and get your money back when you sell —
-- which is the real test of a rule in a game like this.
--
-- This is deliberately *not* FPL's rule (they split the difference on price
-- rises, so a squad's value drifts upward). Theirs is a small economy of its
-- own; ours is a fixed budget. Different game, honestly described, rather than
-- a half-built version of theirs.
--
-- Nullable because it cannot be backfilled: a pick written before this column
-- existed has no recorded purchase price, and inventing one from today's list
-- would be exactly the fabrication the rest of this project refuses. Readers
-- fall back to the current price and the code says so where it does.
--
--
-- 2. WHAT EACH GAMEWEEK'S CHANGES COST IN POINTS
-- -----------------------------------------------
-- One free transfer a gameweek, unused ones banking up to five, four points
-- for anything beyond — the rules live in `lib/fantasy/transfers.ts`, and the
-- *outcome* has to be stored, because it is a fact about a gameweek that has
-- already happened. Recomputing it later from the pick history would give a
-- different answer the moment the rules were tuned, silently rewriting
-- finished seasons.
--
-- `fantasy_squad_gameweek` is one row per squad per gameweek in which a side
-- was saved. Gameweeks with no row are gameweeks where nothing changed, which
-- cost nothing and bank a transfer.
--
--
-- ACCESS
-- ------
-- Same posture as `fantasy_pick`, and for the same reasons: your own rows are
-- yours, league-mates may read a row once that gameweek's deadline has passed,
-- and `anon` gets nothing. A transfer count is a strategic tell before the
-- deadline — knowing a rival has made four changes says something about what
-- they know — so it is gated exactly like the picks it describes.
--
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0009). The project owner must do this by hand.
--
-- IDEMPOTENCY
-- -----------
-- `if not exists` / `drop ... if exists` before create throughout.


-- 1. WHAT EACH PLAYER COST ---------------------------------------------------

alter table fantasy_pick
  add column if not exists price_tenths integer check (price_tenths is null or price_tenths > 0);

comment on column fantasy_pick.price_tenths is
  'What this player cost when bought, in tenths of a million. Null for picks '
  'written before 0010; readers fall back to the current price and say so.';


-- 2. WHAT EACH GAMEWEEK'S CHANGES COST --------------------------------------

create table if not exists fantasy_squad_gameweek (
  squad_id        uuid    not null references fantasy_squad(id) on delete cascade,
  gameweek        integer not null,
  -- Players who came in. Zero is a real value: a manager may save a side to
  -- change the captain or reorder the bench, and neither is a transfer.
  transfers_made  integer not null default 0 check (transfers_made >= 0),
  -- Points docked. Stored rather than derived — see the note above on why
  -- recomputing would rewrite finished seasons.
  transfer_cost   integer not null default 0 check (transfer_cost >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (squad_id, gameweek)
);

grant all privileges on fantasy_squad_gameweek to service_role;
grant select, insert, update, delete on fantasy_squad_gameweek to authenticated;

alter table fantasy_squad_gameweek enable row level security;

drop policy if exists fantasy_squad_gameweek_own_select on fantasy_squad_gameweek;
create policy fantasy_squad_gameweek_own_select on fantasy_squad_gameweek
  for select to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_squad_gameweek_own_insert on fantasy_squad_gameweek;
create policy fantasy_squad_gameweek_own_insert on fantasy_squad_gameweek
  for insert to authenticated
  with check (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_squad_gameweek_own_update on fantasy_squad_gameweek;
create policy fantasy_squad_gameweek_own_update on fantasy_squad_gameweek
  for update to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()))
  with check (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

drop policy if exists fantasy_squad_gameweek_own_delete on fantasy_squad_gameweek;
create policy fantasy_squad_gameweek_own_delete on fantasy_squad_gameweek
  for delete to authenticated
  using (exists (select 1 from fantasy_squad s where s.id = squad_id and s.user_id = auth.uid()));

-- League-mates, once the deadline for that gameweek has passed. Identical in
-- shape and reasoning to `fantasy_pick_league_select` in 0009: before the
-- deadline a rival's transfer count is a tell, and after it the league table
-- cannot be computed without it.
drop policy if exists fantasy_squad_gameweek_league_select on fantasy_squad_gameweek;
create policy fantasy_squad_gameweek_league_select on fantasy_squad_gameweek
  for select to authenticated
  using (
    exists (
      select 1
      from fantasy_squad s
      join fantasy_gameweek g
        on g.season = s.season and g.gameweek = fantasy_squad_gameweek.gameweek
      where s.id = fantasy_squad_gameweek.squad_id
        and public.fantasy_shares_league(auth.uid(), s.user_id)
        and g.deadline_utc is not null
        and g.deadline_utc <= now()
    )
  );
