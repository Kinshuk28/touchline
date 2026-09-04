import type { FixtureStatus } from '@/lib/providers/types';

export interface LeagueRow {
  id: number;
  fd_code: string;
  slug: string;
  name: string;
  country: string;
  emblem_url: string | null;
  current_season: number;
}

export interface TeamLite {
  id: number;
  /**
   * football-data.org's team id — added so the landing page's marquee
   * fixture selection (lib/site/marqueeClubs.ts) can match a team against
   * the curated club list, which is keyed by `fd_id` rather than our
   * internal `id`. Selected by every fixture query alongside the other
   * team fields (lib/site/queries/fixtures.ts's `TEAM_FIELDS`).
   */
  fd_id: number;
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
  /**
   * Free-text kit colours ("Claret / Sky Blue") — parse via
   * `lib/site/clubColors.ts#parseClubColors` before rendering, never used
   * raw. `null` for 14 of the 110 live clubs; never invented. Added to
   * `TEAM_FIELDS` (lib/site/queries/fixtures.ts) alongside `venue` so
   * Direction Two's fixture-row club-colour bar has real per-team data to
   * draw from.
   */
  club_colors: string | null;
  /** `null` for 14 of the 110 live clubs — omitted, never guessed at. */
  venue: string | null;
}

export interface FixtureWithTeams {
  id: number;
  league_id: number;
  season: number;
  kickoff_utc: string;
  status: FixtureStatus;
  matchday: number | null;
  home_goals: number | null;
  away_goals: number | null;
  /** Half-time score — stored since the earliest ingest but never selected
   * or shown anywhere until the match detail page (/match/[id]). */
  half_time_home: number | null;
  half_time_away: number | null;
  updated_at: string;
  home: TeamLite | null;
  away: TeamLite | null;
}

/**
 * One club's row in a competition-season table (`standings`, 192 rows: 96
 * for the completed 2025-26 season, 96 for 2026-27 — see
 * `lib/site/queries/standings.ts#getStandings`). `team` uses the same
 * `TeamLite` shape — and the same embed style — as `FixtureWithTeams`'s
 * `home`/`away`, so `<Crest>` and `lib/site/clubColors.ts` work identically
 * wherever a team appears.
 */
export interface StandingRow {
  league_id: number;
  team_id: number;
  season: number;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  /**
   * Last-five results, oldest-to-most-recent, comma-separated ("W,D,L,W,W")
   * — null or `''` for a season with no matches played yet. Populated for
   * all 96 rows of the completed season, empty for all 96 rows of the
   * season that has not started; never rendered without checking
   * `lib/site/standingsDisplay.ts#parseForm` first, per the spec's "check
   * whether form is actually populated before designing around it."
   */
  form: string | null;
  updated_at: string;
  team: TeamLite | null;
}

/**
 * A club's full row for `/clubs` (`lib/site/queries/teams.ts#getTeams`) —
 * every `teams` column the page needs, unlike `TeamLite` (the fixture/
 * standings embed shape), which omits `founded` and `league_id` since no
 * caller before this one needed them.
 *
 * `league_id`, `venue`, `founded` and `club_colors` are all nullable in the
 * live schema (`supabase/migrations/0001_init.sql`), and for the 14 of 110
 * clubs no longer in a current top-five competition, `venue`, `founded` and
 * `club_colors` are always null together — `scripts/backfill.ts`'s phase 3
 * ("historical clubs") writes exactly those three fields as `null` in the
 * same object literal that gives a historical club its identity, while
 * phase 2 ("current clubs") always writes real values for all three from
 * football-data.org's per-competition teams listing. That's not a
 * coincidence to route around — `getTeams`'s caller relies on it as the
 * signal for which of the 110 rows are current vs. historical (see
 * `app/clubs/page.tsx`), rather than adding a second query against
 * `standings` just to re-derive the same fact.
 */
export interface ClubRow {
  id: number;
  fd_id: number;
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
  venue: string | null;
  founded: number | null;
  club_colors: string | null;
  league_id: number | null;
}

export interface NewsRow {
  id: number;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  categories: string[];
  /**
   * Which top-five competition this story is tied to, or `null` — not every
   * story names a single club (a transfer-window roundup, an award, a
   * refereeing story). Selected by every query that returns a `NewsRow` (see
   * lib/site/queries/news.ts) so a league filter works identically wherever
   * news appears, not just on the one page that happened to need it first.
   */
  league_id: number | null;
}
