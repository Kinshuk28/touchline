import type { LeagueCode } from '@/lib/providers/types';

export interface LeagueSeed {
  code: LeagueCode;
  fdId: number;
  slug: string;
  name: string;
  country: string;
}

/** football-data.org competition ids, verified 2026-08-03. */
export const LEAGUE_SEEDS: LeagueSeed[] = [
  { code: 'PL',  fdId: 2021, slug: 'premier-league', name: 'Premier League', country: 'England' },
  { code: 'PD',  fdId: 2014, slug: 'la-liga',        name: 'La Liga',        country: 'Spain' },
  { code: 'SA',  fdId: 2019, slug: 'serie-a',        name: 'Serie A',        country: 'Italy' },
  { code: 'BL1', fdId: 2002, slug: 'bundesliga',     name: 'Bundesliga',     country: 'Germany' },
  { code: 'FL1', fdId: 2015, slug: 'ligue-1',        name: 'Ligue 1',        country: 'France' },
];

/**
 * Continental competitions — kept out of `LEAGUE_SEEDS` deliberately. Every
 * ingest path that assigns `teams.league_id` (backfill's team phases,
 * scripts/ingest/squads.ts) iterates `LEAGUE_SEEDS` and treats that column
 * as "this club's one domestic league" — folding Champions League into the
 * same list would make every recurring squads run reassign Real Madrid's
 * `league_id` from La Liga to Champions League and back, corrupting the
 * domestic tables/clubs pages. `scripts/ingest/continental.ts` seeds and
 * ingests this list on its own path, recording membership in the
 * `league_teams` join table instead of touching `teams.league_id`.
 *
 * Only Champions League: football-data.org's free tier includes it
 * ("Access to data of these leagues & cups is free. Forever," verified
 * 2026-08-13), but not Europa League or any domestic cup (FA Cup, Copa del
 * Rey, Coppa Italia, DFB-Pokal, Coupe de France) — those sit behind a paid
 * plan, which the project's "no paid services, ever" constraint rules out.
 */
export const CONTINENTAL_SEEDS: LeagueSeed[] = [
  { code: 'CL', fdId: 2001, slug: 'champions-league', name: 'UEFA Champions League', country: 'Europe' },
];

export const CURRENT_SEASON = 2026;
export const PREVIOUS_SEASON = 2025;
