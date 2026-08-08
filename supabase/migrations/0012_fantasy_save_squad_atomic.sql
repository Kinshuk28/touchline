-- 0012_fantasy_save_squad_atomic.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `lib/fantasy/squadStore.ts#saveSquad` has always done four statements over
-- PostgREST -- upsert the squad, delete the old generation, insert the new
-- one, upsert the gameweek's transfer record -- with a comment on it saying
-- plainly that this is not atomic and that fixing it "needs a Postgres
-- function, which is a reasonable follow-up and not worth blocking the
-- picker on." This is that follow-up.
--
-- The actual risk: PostgREST has no transaction across separate HTTP
-- requests, so a failure between the delete and the insert -- a dropped
-- connection, a timeout, the tab closing mid-save -- left a generation
-- empty. Recoverable (the picker reads that as "no squad yet" and offers to
-- rebuild), but a manager whose save silently ate their side one gameweek
-- before a deadline is a worse experience than the extra migration this
-- took to prevent it outright.
--
-- ONE FUNCTION, ONE ROUND TRIP
-- -----------------------------
-- `fantasy_save_squad` does all four writes inside a single `plpgsql`
-- function body, which Postgres runs as one implicit transaction: every
-- statement commits together or none of them do. The delete-then-insert
-- pattern for the generation is unchanged (see 0008's note on why picks are
-- generations, not edits) -- only the "two separate requests" part is gone.
--
-- SECURITY: THE SAME MODEL AS fantasy_join_league (0009)
-- --------------------------------------------------------
-- `security definer` so the function can read/write across the three tables
-- in one go without each statement re-entering RLS, but it never trusts a
-- caller-supplied user id -- `auth.uid()` is read once, from the session
-- token PostgREST already verified, exactly like every other write path in
-- this project. A signed-out caller (`auth.uid() is null`) is rejected
-- before touching a row. This preserves the exact ownership guarantee the
-- RLS policies on these three tables already enforce for every other write;
-- the function does not loosen it, it just does the same writes in one
-- transaction instead of four.
--
-- `p_picks` arrives as `jsonb` (an array of objects) rather than as separate
-- parallel arrays -- PostgREST's RPC calling convention passes function
-- arguments as JSON already, and `jsonb_to_recordset` unpacks it directly
-- into rows for the insert without a client-side flattening step.
--
-- IDEMPOTENCY
-- -----------
-- `create or replace function`, so re-running this file redefines the
-- function rather than failing on it already existing.

create or replace function public.fantasy_save_squad(
  p_season integer,
  p_name text,
  p_active_from_gameweek integer,
  p_picks jsonb,
  p_transfers_made integer,
  p_transfer_cost integer,
  p_chip text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_squad_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to save a squad.' using errcode = '28000';
  end if;

  insert into fantasy_squad (user_id, season, name, updated_at)
  values (v_uid, p_season, p_name, now())
  on conflict (user_id, season)
  do update set name = excluded.name, updated_at = now()
  returning id into v_squad_id;

  delete from fantasy_pick
  where squad_id = v_squad_id
    and active_from_gameweek = p_active_from_gameweek;

  insert into fantasy_pick (
    squad_id, active_from_gameweek, slot, player_id, is_captain, is_vice_captain, price_tenths
  )
  select
    v_squad_id, p_active_from_gameweek, r.slot, r.player_id, r.is_captain, r.is_vice_captain, r.price_tenths
  from jsonb_to_recordset(p_picks) as r(
    slot integer, player_id bigint, is_captain boolean, is_vice_captain boolean, price_tenths integer
  );

  insert into fantasy_squad_gameweek (squad_id, gameweek, transfers_made, transfer_cost, chip, updated_at)
  values (v_squad_id, p_active_from_gameweek, p_transfers_made, p_transfer_cost, p_chip, now())
  on conflict (squad_id, gameweek)
  do update set
    transfers_made = excluded.transfers_made,
    transfer_cost  = excluded.transfer_cost,
    chip           = excluded.chip,
    updated_at     = now();

  return v_squad_id;
end;
$$;

-- Definer functions are executable by `public` (which includes `anon`)
-- unless told otherwise -- same footgun 0009 calls out. Signed-in only.
revoke execute on function public.fantasy_save_squad(integer, text, integer, jsonb, integer, integer, text) from public;
grant execute on function public.fantasy_save_squad(integer, text, integer, jsonb, integer, integer, text) to authenticated;
