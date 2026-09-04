-- 0014_fixture_goals.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The match detail page (/match/[id]) wants to say who scored, not just the
-- final score `fixtures.home_goals`/`away_goals` already carries. That's a
-- new fact this schema has never stored: which player scored, in which
-- minute, for which team, assisted by whom.
--
-- BEST-EFFORT, NOT GUARANTEED
-- ---------------------------
-- football-data.org's match-detail endpoint (`/v4/matches/{id}`) documents a
-- `goals` array with exactly this shape, but nothing in the project's own
-- research (docs/superpowers/specs/2026-08-03-touchline-data-spine-and-site-design.md)
-- ever tested whether this specific endpoint is populated on the free tier —
-- that research covered fixtures/results/tables/squads/scorers, not
-- per-match event detail. scripts/ingest/matchDetails.ts treats a 403/404
-- here exactly like scripts/ingest/continental.ts treats one: a tolerable
-- "not available", not a failure. If it turns out the free tier never
-- populates this, this table simply stays empty and the match detail page's
-- goals section stays hidden — never a fabricated scorer.
--
-- REPLACE, NOT UPSERT
-- -------------------
-- football-data.org's goal objects carry no stable per-goal id — nothing to
-- conflict on. scripts/ingest/matchDetails.ts deletes every row for a
-- fixture and reinserts the current set on each ingest, rather than upserting
-- on a composite key that could either collide on a genuine rare duplicate
-- (two goals, same scorer, same minute) or fail to update a corrected entry.
--
-- PUBLIC READ
-- -----------
-- Same posture as every other reference table here: goal detail is
-- published match data, read-only for anon/authenticated.
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run. The project owner must do this by hand.
--
-- Until it is applied, the match detail page's goals section simply stays
-- empty (lib/site/queries/fixtureGoals.ts#isMissingTable-style tolerance,
-- mirroring lib/site/queries/fantasy.ts's own unapplied-migration handling)
-- rather than erroring.
--
-- IDEMPOTENCY
-- -----------
-- Every statement is `if not exists` / `drop ... if exists` before create.

create table if not exists fixture_goals (
  id           bigserial primary key,
  fixture_id   bigint  not null references fixtures(id) on delete cascade,
  team_id      bigint  references teams(id) on delete set null,
  minute       integer,
  scorer_name  text    not null,
  assist_name  text,
  type         text,
  updated_at   timestamptz not null default now()
);

create index if not exists fixture_goals_fixture_id_idx on fixture_goals (fixture_id);

grant all privileges on fixture_goals to service_role;
grant select on fixture_goals to anon, authenticated;

alter table fixture_goals enable row level security;
drop policy if exists fixture_goals_select_all on fixture_goals;
create policy fixture_goals_select_all on fixture_goals
  for select to anon, authenticated using (true);
