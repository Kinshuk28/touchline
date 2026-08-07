-- 0011_fantasy_chips.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Chips: the four one-off moves a manager gets in a season — Wildcard, Free
-- Hit, Triple Captain, Bench Boost. Every rule about them lives in
-- `lib/fantasy/chips.ts`; the only thing the database has to hold is *which
-- one was played, and when*, and that is one column.
--
-- It goes on `fantasy_squad_gameweek` because that is already the table
-- recording what a manager did in a gameweek, and a chip is exactly that. A
-- table of its own would be a second row per gameweek saying something about
-- the same event.
--
--
-- WHY A COLUMN AND NOT DERIVED
-- ----------------------------
-- The same reason `transfer_cost` is stored (0010): a chip changes how a
-- gameweek scored, and a finished gameweek's score must not move because
-- somebody later changed a rule. `chip` records what was played; the effects
-- are recomputed from it, but the fact is not re-derived.
--
--
-- THE CONSTRAINT IS THE POINT
-- ---------------------------
-- One chip per gameweek falls out of the primary key — there is one row per
-- (squad, gameweek), so there is nowhere to put a second. The once-a-season
-- rules (and the Wildcard's one-per-half) are *not* enforced here: they need
-- to look across a season's rows, and expressing that as a constraint would
-- mean a trigger holding rules that already exist, tested, in
-- `lib/fantasy/chips.ts`. The server action checks them before writing.
--
-- That is a deliberate difference from the ownership rules, which *are*
-- enforced in the database. The distinction: ownership protects one user
-- from another and must hold against a crafted request, whereas a chip
-- budget is a game rule a manager can only break against themselves. Worth
-- being explicit about, because the two look similar and are not.
--
--
-- ACCESS
-- ------
-- Inherited unchanged from 0010 — the policies are on the table, not the
-- column. Your own rows are yours; a league-mate reads a gameweek's row once
-- that gameweek's deadline has passed. Which chip a rival is about to play is
-- a tell worth as much as their transfers, and it is gated identically.
--
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0010). The project owner must do this by hand.
--
-- IDEMPOTENCY
-- -----------
-- `add column if not exists`, and the constraint is dropped before being
-- added.

alter table fantasy_squad_gameweek
  add column if not exists chip text;

-- Named and re-created rather than inlined, so re-running the file does not
-- fail on a constraint that is already there.
alter table fantasy_squad_gameweek
  drop constraint if exists fantasy_squad_gameweek_chip_known;
alter table fantasy_squad_gameweek
  add constraint fantasy_squad_gameweek_chip_known
  check (chip is null or chip in ('wildcard', 'free-hit', 'triple-captain', 'bench-boost'));

comment on column fantasy_squad_gameweek.chip is
  'The chip played this gameweek, or null. Values match the Chip union in '
  'lib/fantasy/chips.ts; the once-a-season and one-per-half rules are checked '
  'there and in the server action, not by a constraint.';

-- The picker asks "which chips has this squad already played" on every load.
-- Partial, because the rows that matter are the few with a chip, not the
-- thirty-odd without one.
create index if not exists fantasy_squad_gameweek_chip_idx
  on fantasy_squad_gameweek (squad_id, chip)
  where chip is not null;
