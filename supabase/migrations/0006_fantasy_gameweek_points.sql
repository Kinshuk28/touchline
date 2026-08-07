-- 0006_fantasy_gameweek_points.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Phase C (docs/superpowers/specs/2026-08-07-fantasy-phase-c.md) needs one
-- thing this database has never held: **per-matchday player scoring**.
-- `player_season_stats` holds season aggregates, and the spec spells out why
-- differencing those into weekly points is not an option -- an ingest gap
-- silently becomes a zero-point week and an upstream correction becomes a
-- negative one. A fantasy game scored on arithmetic like that would be
-- wrong in exactly the weeks anyone cared about.
--
-- So: one row per player per gameweek, written by `scripts/ingest/fantasy.ts`
-- from FPL's `event/{id}/live`, never derived from anything else.
--
-- PREMIER LEAGUE ONLY, AND THE SCHEMA SAYS SO
-- --------------------------------------------
-- There is no free per-match player feed for La Liga, Serie A, the
-- Bundesliga or Ligue 1. `league_id` is therefore deliberately absent rather
-- than present-and-always-PL: a nullable or single-valued column would read
-- as an invitation to fill it, and the honest statement is that this table's
-- grain is FPL's gameweek, which only exists for one competition. When a
-- second competition ever has a real source, that is a schema change made
-- deliberately, not a column quietly repurposed.
--
-- POINTS ARE FPL'S, NOT OURS
-- --------------------------
-- `points` is FPL's published `total_points` for that gameweek, stored as
-- published. Their rules change between seasons -- defensive contribution
-- points arrived in 2025-26 -- so recomputing the figure here would create a
-- second source of truth that drifts from the first without anyone noticing.
-- The component columns (goals, assists, bonus, ...) exist so a score can be
-- *explained* on a page, never so it can be re-derived. See
-- `lib/providers/fpl.ts`.
--
-- Every stat column is nullable on purpose. `null` means FPL published
-- nothing for that field; it is never a substituted zero. A real published
-- zero still stores as `0`, and `lib/fantasy/scoring.ts` treats the two
-- differently -- an unpublished score is `pending`, not a blank week, and an
-- unpublished `minutes` does not trigger an auto-substitution.
--
-- `is_final` MIRRORS FPL'S `data_checked`
-- ----------------------------------------
-- A gameweek's points move after the whistle: bonus points land, and FPL
-- issues corrections for a day or two. `data_checked` is FPL's own flag for
-- "this gameweek is settled". Storing it lets the ingest job skip finalised
-- gameweeks entirely (see `lib/ingest/gameweekSchedule.ts`) and lets a page
-- say "provisional" honestly instead of showing a moving number as final.
--
-- PUBLIC READ, LIKE EVERY OTHER TABLE HERE
-- -----------------------------------------
-- These are published football statistics with no user data in them. The
-- *user* side of fantasy -- squads, picks, leagues -- is a separate concern
-- with per-user RLS, and is not part of this migration. Nothing in this
-- table belongs to anyone.
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0005). The project owner must do this by hand; this
-- agent holds no credentials that could.
--
-- Until it is applied, `scripts/ingest/fantasy.ts` fails its run with a
-- clear message and the site is unaffected -- no read path touches this
-- table yet.
--
-- IDEMPOTENCY
-- -----------
-- Every statement is `if not exists` / `or replace` / `drop ... if exists`
-- before create, so the whole file is safe to run more than once.

create table if not exists fantasy_gameweek_points (
  player_id         bigint  not null references players(id) on delete cascade,
  season            integer not null,
  gameweek          integer not null,
  -- FPL's published total for the gameweek. Null until they publish one.
  points            integer,
  minutes           integer,
  goals             integer,
  assists           integer,
  clean_sheets      integer,
  goals_conceded    integer,
  own_goals         integer,
  penalties_saved   integer,
  penalties_missed  integer,
  yellow_cards      integer,
  red_cards         integer,
  saves             integer,
  bonus             integer,
  -- FPL's `data_checked`: the gameweek is settled and will not move again.
  is_final          boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (player_id, season, gameweek)
);

-- The two queries this table exists to serve. Scoring a squad reads one
-- gameweek across many players; a player page reads one player's season.
-- The primary key already serves the second (its leading column is
-- player_id), so only the first needs an index of its own.
create index if not exists fantasy_gw_season_week_idx
  on fantasy_gameweek_points (season, gameweek);

-- 0002 set default privileges in this schema, but those only apply to
-- objects created by the role that set them. Granting explicitly here costs
-- nothing and removes the question entirely.
grant all privileges on fantasy_gameweek_points to service_role;
grant select on fantasy_gameweek_points to anon, authenticated;

-- Same posture as every other table (0002): reads are public, writes are
-- service_role only, enforced by the absence of a write grant *and* by RLS.
alter table fantasy_gameweek_points enable row level security;
drop policy if exists fantasy_gameweek_points_select_all on fantasy_gameweek_points;
create policy fantasy_gameweek_points_select_all on fantasy_gameweek_points
  for select to anon, authenticated using (true);
