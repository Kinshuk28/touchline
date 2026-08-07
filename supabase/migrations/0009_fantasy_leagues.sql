-- 0009_fantasy_leagues.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Leagues against friends. Two tables, and a genuinely awkward access
-- problem that the rest of this file is mostly about.
--
--
-- THE PROBLEM: A LEAGUE TABLE HAS TO SHOW OTHER PEOPLE'S SQUADS
-- --------------------------------------------------------------
-- 0008 says a squad is visible only to `auth.uid() = user_id`. That is the
-- right default and it makes a league table impossible: to show what a rival
-- scored you have to read their picks and total them.
--
-- So this migration widens the door by exactly the width of a league, and
-- not a millimetre more:
--
--   * `fantasy_squad` becomes readable to anyone who shares a league with
--     its owner. A squad row is a name and a season; nothing sensitive.
--   * `fantasy_pick` becomes readable to league-mates **only once that
--     generation's own deadline has passed**. Before the deadline a rival's
--     side stays private, because a fantasy game where you can read your
--     opponents' teams before kick-off is a fantasy game where everybody
--     picks the same eleven. This is a rule, not a nicety, and putting it in
--     the policy rather than in a query is what makes it true regardless of
--     which query asks.
--   * Everything else about 0008 is untouched. Writes are still own-rows-only,
--     `anon` still gets nothing at all on either table.
--
--
-- THE TRAP: POLICIES THAT REFERENCE THEIR OWN TABLE RECURSE
-- ----------------------------------------------------------
-- The obvious membership policy — "you can see members of leagues you are a
-- member of" — reads `fantasy_league_member` from inside
-- `fantasy_league_member`'s own policy, and Postgres reports infinite
-- recursion at query time rather than at migration time. It is a well-worn
-- Supabase footgun and the reason for the three `security definer` functions
-- below: a definer function runs as its owner and therefore does *not*
-- re-enter RLS, which breaks the cycle at exactly one point.
--
-- Each one is `set search_path = public` (a definer function without a fixed
-- search_path is a privilege-escalation hole), `stable` where it reads, and
-- executable by `authenticated` only — never `anon`, never `public`.
--
--
-- JOINING IS A FUNCTION, NOT A SELECT
-- ------------------------------------
-- To join a league by code you would have to look the league up first, and a
-- policy that lets you do that lets you enumerate every league on the site.
-- So `fantasy_league` is readable *only by members*, and joining goes through
-- `fantasy_join_league(code)`, which resolves the code and inserts the
-- membership in one definer call. `authenticated` is granted no INSERT on
-- `fantasy_league_member` at all — the only ways in are that function and the
-- trigger that makes a league's creator its first member.
--
-- A join code is therefore a bearer credential, and is sized like one: eight
-- characters from a 30-symbol alphabet with the ambiguous glyphs (0/O, 1/I/L,
-- U) removed, so ~6.5e11 codes, and a code read aloud over the phone still
-- works.
--
--
-- THIS MIGRATION HAS NOT BEEN APPLIED
-- -----------------------------------
-- Apply via the Supabase dashboard -> SQL Editor -> New query -> paste this
-- file -> Run (after 0008). The project owner must do this by hand.
--
-- Until it is applied, /fantasy/leagues says so plainly and the picker is
-- unaffected.
--
-- IDEMPOTENCY
-- -----------
-- `if not exists` / `or replace` / `drop ... if exists` before create
-- throughout, including the trigger.


-- 1. TABLES ----------------------------------------------------------------

create table if not exists fantasy_league (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid    not null references auth.users(id) on delete cascade,
  season      integer not null,
  name        text    not null check (length(trim(name)) between 1 and 40),
  -- Filled by the default below. Unique because it is how a league is found.
  join_code   text    not null unique,
  created_at  timestamptz not null default now()
);

create index if not exists fantasy_league_owner_idx on fantasy_league (owner_id);

create table if not exists fantasy_league_member (
  league_id  uuid not null references fantasy_league(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists fantasy_league_member_user_idx on fantasy_league_member (user_id);


-- 2. THE DEFINER FUNCTIONS THAT BREAK THE RECURSION ------------------------

-- Which leagues a user belongs to. Runs as owner, so reading
-- `fantasy_league_member` here does not re-enter that table's policy — which
-- is the whole point, since that policy calls this function.
create or replace function public.fantasy_leagues_for(p_uid uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select league_id from fantasy_league_member where user_id = p_uid;
$$;

-- Do these two people share a league? The question every widened policy
-- below actually asks. A user always shares a league with themselves, so
-- callers do not have to special-case their own rows.
create or replace function public.fantasy_shares_league(p_a uuid, p_b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_a is not null and p_b is not null and (
    p_a = p_b or exists (
      select 1
      from fantasy_league_member mine
      join fantasy_league_member theirs on theirs.league_id = mine.league_id
      where mine.user_id = p_a and theirs.user_id = p_b
    )
  );
$$;

-- A join code nobody already holds. The loop is not paranoia about the
-- birthday problem at 6.5e11 codes; it is that a `default` which can collide
-- turns a routine insert into an error a user cannot act on.
create or replace function public.fantasy_new_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- No 0/O, 1/I/L or U: a code gets read aloud and typed by someone else.
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from fantasy_league where join_code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table fantasy_league alter column join_code set default public.fantasy_new_join_code();

-- A league with no members cannot be read by anyone, including the person
-- who just made it — `fantasy_league`'s select policy is membership-based.
-- This trigger is what makes creating a league and being in it the same act.
create or replace function public.fantasy_league_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into fantasy_league_member (league_id, user_id)
  values (new.id, new.owner_id)
  on conflict (league_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists fantasy_league_owner_member on fantasy_league;
create trigger fantasy_league_owner_member
  after insert on fantasy_league
  for each row execute function public.fantasy_league_add_owner();

-- Join by code. Definer because resolving a code means reading a league you
-- are not yet a member of, and no policy can express "may read the one row
-- whose secret you already know" without also allowing a scan.
create or replace function public.fantasy_join_league(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to join a league.' using errcode = '28000';
  end if;

  -- Forgiving about how the code was pasted — spaces, dashes and lower case
  -- are all things a person will send you — strict about what it matches.
  select id into v_id
  from fantasy_league
  where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));

  if v_id is null then
    raise exception 'No league has that code.' using errcode = 'P0002';
  end if;

  insert into fantasy_league_member (league_id, user_id)
  values (v_id, v_uid)
  on conflict (league_id, user_id) do nothing;

  return v_id;
end;
$$;

-- Definer functions are executable by `public` unless told otherwise, and
-- `public` includes `anon`. Every one of these is for signed-in users only.
revoke execute on function public.fantasy_leagues_for(uuid) from public;
revoke execute on function public.fantasy_shares_league(uuid, uuid) from public;
revoke execute on function public.fantasy_new_join_code() from public;
revoke execute on function public.fantasy_join_league(text) from public;

grant execute on function public.fantasy_leagues_for(uuid) to authenticated;
grant execute on function public.fantasy_shares_league(uuid, uuid) to authenticated;
grant execute on function public.fantasy_new_join_code() to authenticated;
grant execute on function public.fantasy_join_league(text) to authenticated;


-- 3. GRANTS AND POLICIES ---------------------------------------------------

grant all privileges on fantasy_league to service_role;
grant all privileges on fantasy_league_member to service_role;

-- `anon` gets nothing on either table. Note also what `authenticated` does
-- *not* get: INSERT on fantasy_league_member. The only ways into a league are
-- the owner trigger and fantasy_join_league, both of which require either
-- creating the league or knowing its code.
grant select, insert, update, delete on fantasy_league to authenticated;
grant select, delete on fantasy_league_member to authenticated;

alter table fantasy_league enable row level security;
alter table fantasy_league_member enable row level security;

-- Members only. A non-member cannot read a league even knowing its id, which
-- is what keeps `fantasy_join_league` the only way a code is worth anything.
drop policy if exists fantasy_league_member_select on fantasy_league;
create policy fantasy_league_member_select on fantasy_league
  for select to authenticated
  using (id in (select public.fantasy_leagues_for(auth.uid())));

drop policy if exists fantasy_league_own_insert on fantasy_league;
create policy fantasy_league_own_insert on fantasy_league
  for insert to authenticated with check (auth.uid() = owner_id);

-- Renaming is the only update anyone needs; `with check` stops an owner
-- handing a league to someone else by editing `owner_id`.
drop policy if exists fantasy_league_owner_update on fantasy_league;
create policy fantasy_league_owner_update on fantasy_league
  for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists fantasy_league_owner_delete on fantasy_league;
create policy fantasy_league_owner_delete on fantasy_league
  for delete to authenticated using (auth.uid() = owner_id);

-- Fellow members are visible to each other; nobody else sees the roster.
-- Via the definer function, so this does not read its own table under RLS.
drop policy if exists fantasy_league_member_read on fantasy_league_member;
create policy fantasy_league_member_read on fantasy_league_member
  for select to authenticated
  using (league_id in (select public.fantasy_leagues_for(auth.uid())));

-- Leaving is your own decision; removing somebody is the owner's. Both are
-- deletes on this table, and they are the same policy because they are the
-- same operation seen from two sides.
drop policy if exists fantasy_league_member_leave on fantasy_league_member;
create policy fantasy_league_member_leave on fantasy_league_member
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from fantasy_league l where l.id = league_id and l.owner_id = auth.uid())
  );


-- 4. WIDENING 0008 BY EXACTLY THE WIDTH OF A LEAGUE ------------------------

-- Additional to `fantasy_squad_own_select` from 0008, not a replacement:
-- permissive policies are OR'd, so your own squad stays readable whether or
-- not you are in any league at all.
drop policy if exists fantasy_squad_league_select on fantasy_squad;
create policy fantasy_squad_league_select on fantasy_squad
  for select to authenticated
  using (public.fantasy_shares_league(auth.uid(), user_id));

-- A rival's picks, once that side is locked in.
--
-- The deadline test is the anti-copying rule, and it is deliberately keyed to
-- the *generation's own* gameweek rather than to "now": a side saved for
-- gameweek 7 becomes readable when gameweek 7's deadline passes, and stays
-- readable forever after, which is exactly what a league table needs to
-- recompute history. A generation still in the future stays private.
--
-- `deadline_utc is not null` because an unknown deadline must not read as
-- "already passed" — that would publish a side before it was locked.
drop policy if exists fantasy_pick_league_select on fantasy_pick;
create policy fantasy_pick_league_select on fantasy_pick
  for select to authenticated
  using (
    exists (
      select 1
      from fantasy_squad s
      join fantasy_gameweek g
        on g.season = s.season and g.gameweek = fantasy_pick.active_from_gameweek
      where s.id = fantasy_pick.squad_id
        and public.fantasy_shares_league(auth.uid(), s.user_id)
        and g.deadline_utc is not null
        and g.deadline_utc <= now()
    )
  );
