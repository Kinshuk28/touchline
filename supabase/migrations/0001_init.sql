create extension if not exists pg_trgm;

create table leagues (
  id            bigserial primary key,
  fd_code       text unique not null,
  fd_id         integer unique not null,
  slug          text unique not null,
  name          text not null,
  country       text not null,
  emblem_url    text,
  current_season integer not null,
  season_start  date,
  season_end    date,
  updated_at    timestamptz not null default now()
);

create table teams (
  id          bigserial primary key,
  fd_id       integer unique not null,
  league_id   bigint references leagues(id) on delete cascade,
  slug        text unique not null,
  name        text not null,
  short_name  text,
  tla         text,
  crest_url   text,
  venue       text,
  founded     integer,
  club_colors text,
  updated_at  timestamptz not null default now()
);

create table players (
  id            bigserial primary key,
  fd_id         integer unique,
  fpl_id        integer unique,
  team_id       bigint references teams(id) on delete set null,
  slug          text unique not null,
  name          text not null,
  position      text,
  nationality   text,
  date_of_birth date,
  photo_url     text,
  updated_at    timestamptz not null default now()
);

create table fixtures (
  id              bigserial primary key,
  fd_id           integer unique not null,
  league_id       bigint not null references leagues(id) on delete cascade,
  home_team_id    bigint references teams(id) on delete set null,
  away_team_id    bigint references teams(id) on delete set null,
  season          integer not null,
  kickoff_utc     timestamptz not null,
  status          text not null,
  matchday        integer,
  home_goals      integer,
  away_goals      integer,
  half_time_home  integer,
  half_time_away  integer,
  last_updated    timestamptz,
  updated_at      timestamptz not null default now()
);

create table standings (
  league_id        bigint not null references leagues(id) on delete cascade,
  team_id          bigint not null references teams(id) on delete cascade,
  season           integer not null,
  position         integer not null,
  played           integer not null,
  won              integer not null,
  drawn            integer not null,
  lost             integer not null,
  goals_for        integer not null,
  goals_against    integer not null,
  goal_difference  integer not null,
  points           integer not null,
  form             text,
  updated_at       timestamptz not null default now(),
  primary key (league_id, season, team_id)
);

create table player_season_stats (
  player_id       bigint not null references players(id) on delete cascade,
  league_id       bigint not null references leagues(id) on delete cascade,
  season          integer not null,
  source          text not null,
  appearances     integer,
  minutes         integer,
  goals           integer,
  assists         integer,
  expected_goals  numeric(6,2),
  yellow_cards    integer,
  red_cards       integer,
  updated_at      timestamptz not null default now(),
  primary key (player_id, season, source)
);

create table news_items (
  id           bigserial primary key,
  source       text not null,
  title        text not null,
  summary      text,
  url          text not null,
  image_url    text,
  published_at timestamptz not null,
  league_id    bigint references leagues(id) on delete set null,
  team_ids     bigint[] not null default '{}',
  categories   text[] not null default '{}',
  content_hash text unique not null,
  created_at   timestamptz not null default now()
);

create table ingest_run (
  id            bigserial primary key,
  job           text not null,
  status        text not null,
  message       text,
  requests_used integer not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table ingest_budget (
  provider      text not null,
  day_utc       date not null,
  requests_used integer not null default 0,
  primary key (provider, day_utc)
);

create index fixtures_kickoff_idx    on fixtures (kickoff_utc);
create index fixtures_status_idx     on fixtures (status);
create index fixtures_league_season  on fixtures (league_id, season);
create index standings_lookup_idx    on standings (league_id, season, position);
create index news_published_idx      on news_items (published_at desc);
create index teams_name_trgm         on teams  using gin (name gin_trgm_ops);
create index players_name_trgm       on players using gin (name gin_trgm_ops);
