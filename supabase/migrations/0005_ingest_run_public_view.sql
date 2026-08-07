-- 0005_ingest_run_public_view.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `/status` shows whether the ingest jobs are still running. It cannot read
-- `ingest_run` directly: 0003_lock_down_ingest_observability.sql revoked
-- anon SELECT on that table, for a good reason that still holds --
-- `ingest_run.message` carries an unfiltered slice of the upstream
-- provider's error body, and anon SELECT would make that column
-- world-readable through PostgREST.
--
-- 0003 suggested the eventual `/status` page read the table server-side
-- with the service-role key. It cannot do that either: this project's
-- standing rule is that the service-role client never enters anything the
-- site renders (lib/site/supabase.ts spells this out), and putting a
-- full-power key into the render path to draw a status table would be a
-- much worse trade than leaving the table undrawn.
--
-- So: a view over the same rows with `message` omitted entirely. Job name,
-- status, timings and request count are operational facts with no capacity
-- to carry an upstream response body. 0003's revoke stays exactly as it is;
-- nothing about the base table's posture changes.
--
-- WHAT THIS DOES NOT EXPOSE
-- -------------------------
-- * `ingest_run.message` -- the reason 0003 exists. A failure's reason
--   stays where it belongs, in the GitHub Actions log.
-- * `ingest_budget` -- untouched, still private.
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run. The project owner must do this by hand; this agent has no
-- credentials that could.
--
-- Until it is applied, `/status` renders its data-freshness panel normally
-- and says plainly that job history is not readable -- it does not fail.
--
-- IDEMPOTENCY
-- -----------
-- `create or replace view` and the grant are both safe to run repeatedly.

-- `security_invoker = on` makes the view run with the *caller's* rights, not
-- the view owner's. Without it a view owned by a superuser silently becomes
-- a way around the very revoke 0003 performed -- for every column it
-- selects. With it on, the grant below is the only thing that opens this up,
-- and it opens exactly the five columns named here.
create or replace view ingest_run_public
with (security_invoker = on) as
  select id, job, status, requests_used, started_at, finished_at
  from ingest_run;

-- The base table stays revoked for anon (0003). `security_invoker` means the
-- caller's own rights apply to the underlying table, so the view alone is
-- not enough -- anon needs SELECT on `ingest_run` for the columns the view
-- reads. Granting column-level SELECT is what keeps `message` unreachable
-- while letting these five through: a `select message from ingest_run` by
-- anon still fails, and so does `select * from ingest_run`.
grant select (id, job, status, requests_used, started_at, finished_at)
  on ingest_run to anon, authenticated;

-- RLS is still enabled on `ingest_run` from 0002 and 0003 dropped its
-- permissive policy, so column grants alone would still return nothing.
-- This policy restores read access for the observability rows only, and the
-- column grant above is what keeps `message` out of reach regardless.
drop policy if exists ingest_run_public_read on ingest_run;
create policy ingest_run_public_read on ingest_run
  for select to anon, authenticated
  using (true);

grant select on ingest_run_public to anon, authenticated;
