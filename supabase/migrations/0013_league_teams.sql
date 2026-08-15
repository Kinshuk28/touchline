-- 0013_league_teams.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `teams.league_id` is a single, nullable foreign key — "this club's one
-- domestic league" (see lib/db/repositories/teams.ts). That has been a safe
-- assumption for every competition this project has ingested so far,
-- because a club plays in exactly one of the five tracked domestic leagues
-- at a time.
--
-- Champions League breaks that assumption on purpose: Real Madrid is a La
-- Liga club *and* a Champions League club, at the same time, every season.
-- Reusing `teams.league_id` for that would mean the recurring squads/core
-- ingest jobs fight over a single column — whichever competition ingested
-- last would silently evict the other, and Real Madrid would vanish from
-- the La Liga clubs page the next time Champions League ingest ran (or vice
-- versa). That is not a hypothetical: scripts/ingest/squads.ts re-upserts
-- every club's `league_id` on every run.
--
-- `league_teams` is the many-to-many fact this needs: which teams play in
-- which competition, for a given season, without touching `teams.league_id`
-- at all. Domestic league membership keeps working exactly as it does
-- today; Champions League (scripts/ingest/continental.ts) is layered on top
-- through this table alone.
--
-- PUBLIC READ
-- -----------
-- Same posture as every other reference table here: club/competition
-- membership is published data, read-only for anon/authenticated.
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run. The project owner must do this by hand.
--
-- Until it is applied, scripts/ingest/continental.ts has nowhere to write
-- Champions League team membership and fails loudly rather than silently
-- doing nothing.
--
-- IDEMPOTENCY
-- -----------
-- Every statement is `if not exists` / `drop ... if exists` before create.

create table if not exists league_teams (
  league_id  bigint  not null references leagues(id) on delete cascade,
  team_id    bigint  not null references teams(id) on delete cascade,
  season     integer not null,
  updated_at timestamptz not null default now(),
  primary key (league_id, team_id, season)
);

-- The reverse lookup ("which competitions is this club in this season") a
-- club/player page would use — the primary key above already covers the
-- forward direction ("which clubs are in this competition") efficiently.
create index if not exists league_teams_team_id_idx on league_teams (team_id);

grant all privileges on league_teams to service_role;
grant select on league_teams to anon, authenticated;

alter table league_teams enable row level security;
drop policy if exists league_teams_select_all on league_teams;
create policy league_teams_select_all on league_teams
  for select to anon, authenticated using (true);
