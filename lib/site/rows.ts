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
  updated_at: string;
  home: TeamLite | null;
  away: TeamLite | null;
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
}
