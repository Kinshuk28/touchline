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

export const CURRENT_SEASON = 2026;
export const PREVIOUS_SEASON = 2025;
