-- 0002_grants_and_rls.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- 0001_init.sql was applied through the Supabase SQL Editor. Creating a table
-- there does NOT grant the PostgREST roles (anon, authenticated, service_role)
-- any privileges on it -- Postgres privileges are always explicit, and the
-- SQL Editor session's own role owns the new tables but nobody else does.
-- The symptom, confirmed empirically: "permission denied for table leagues"
-- on every PostgREST request, for every role, including service_role.
--
-- POSTURE ENFORCED BELOW (do not "simplify" this away)
-- ------------------------------------------------------
-- - service_role: full read/write on everything. Ingestion jobs use this key
--   from trusted server-side code only. It also bypasses RLS by design, so
--   the RLS policies below are irrelevant to it -- they exist for the other
--   two roles.
-- - anon / authenticated: SELECT only, enforced twice over:
--     1. GRANT only ever gives them SELECT, never INSERT/UPDATE/DELETE.
--     2. RLS is enabled on every table with a read-only policy, so even if a
--        future migration accidentally grants anon a write privilege, RLS
--        still blocks the write.
--   This matters because Phase B ships the anon key to the browser. Anyone
--   who loads the site holds that key. If anon ever gets write access, any
--   visitor could insert fabricated fixtures or delete standings.
--
-- All nine tables hold public football data or pipeline-observability data
-- (ingest_run, ingest_budget) -- nothing here is secret, so public SELECT on
-- all of them is intentional and correct.
--
-- IDEMPOTENCY
-- -----------
-- Every statement below is safe to run more than once: GRANT, ALTER DEFAULT
-- PRIVILEGES and ENABLE ROW LEVEL SECURITY are naturally idempotent in
-- Postgres (re-running them re-asserts the same state, no error); policies
-- are dropped with IF EXISTS immediately before being recreated.

-- 1. Let every PostgREST role reach objects in the public schema at all.
--    Without USAGE on the schema, no privilege granted on a table inside it
--    matters -- the schema itself is invisible to the role.
grant usage on schema public to anon, authenticated, service_role;

-- 2. service_role: full read/write on every existing table and sequence.
--    This is the role ingestion jobs authenticate with; it also bypasses RLS
--    entirely, so it needs no policies -- only these grants.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 3. anon / authenticated: SELECT only. Never insert/update/delete.
--    The anon key ships to the browser in Phase B, so this is the
--    load-bearing restriction in this file -- do not widen it to
--    `all privileges` or add insert/update/delete.
grant select on all tables in schema public to anon, authenticated;

--    Sequences are deliberately NOT granted to anon/authenticated here.
--    A sequence is only touched via nextval() (on INSERT of a serial/identity
--    column) or currval()/setval(), and these two roles never insert or
--    update anything -- that is the entire point of this migration. Granting
--    USAGE or SELECT on sequences to a read-only role would add no working
--    functionality; it would just be an unused privilege sitting around for
--    a future reader to mistake as license to allow writes. So: nothing is
--    granted on sequences to anon/authenticated, on purpose.

-- 4. Make this posture automatic for tables/sequences created by later
--    migrations, so the next migration doesn't silently reintroduce the very
--    bug this file fixes.
alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;

alter default privileges in schema public
  grant select on tables to anon, authenticated;

-- 5 & 6. Row Level Security on every table, with a read-only policy for
-- anon/authenticated. This is defence in depth: service_role bypasses RLS by
-- design, so this section only ever constrains anon/authenticated -- exactly
-- the roles this migration intends to keep read-only even if some future
-- change widens the GRANTs above by accident.

alter table leagues enable row level security;
drop policy if exists leagues_select_all on leagues;
create policy leagues_select_all on leagues
  for select to anon, authenticated using (true);

alter table teams enable row level security;
drop policy if exists teams_select_all on teams;
create policy teams_select_all on teams
  for select to anon, authenticated using (true);

alter table players enable row level security;
drop policy if exists players_select_all on players;
create policy players_select_all on players
  for select to anon, authenticated using (true);

alter table fixtures enable row level security;
drop policy if exists fixtures_select_all on fixtures;
create policy fixtures_select_all on fixtures
  for select to anon, authenticated using (true);

alter table standings enable row level security;
drop policy if exists standings_select_all on standings;
create policy standings_select_all on standings
  for select to anon, authenticated using (true);

alter table player_season_stats enable row level security;
drop policy if exists player_season_stats_select_all on player_season_stats;
create policy player_season_stats_select_all on player_season_stats
  for select to anon, authenticated using (true);

alter table news_items enable row level security;
drop policy if exists news_items_select_all on news_items;
create policy news_items_select_all on news_items
  for select to anon, authenticated using (true);

alter table ingest_run enable row level security;
drop policy if exists ingest_run_select_all on ingest_run;
create policy ingest_run_select_all on ingest_run
  for select to anon, authenticated using (true);

alter table ingest_budget enable row level security;
drop policy if exists ingest_budget_select_all on ingest_budget;
create policy ingest_budget_select_all on ingest_budget
  for select to anon, authenticated using (true);
