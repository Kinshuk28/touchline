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
  slug: string;
  name: string;
  short_name: string | null;
  tla: string | null;
  crest_url: string | null;
}

export interface FixtureWithTeams {
  id: number;
  league_id: number;
  season: number;
  kickoff_utc: string;
  status: string;
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
