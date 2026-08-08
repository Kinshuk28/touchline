import type { FixtureWithTeams } from '@/lib/site/rows';

/**
 * Each club's next fixture — the one piece of context missing from the
 * transfer market: a player's price and season points say nothing about
 * whether their club is about to play the league leaders away or the
 * bottom club at home. Built from fixtures already ingested for every other
 * page on the site (`lib/site/queries/fixtures.ts#getUpcoming`); no new
 * source, no new ingest.
 *
 * Pure and independent of any fantasy-specific data — a club's fixture list
 * doesn't know or care who has them in a squad.
 */

export interface UpcomingOpponent {
  opponentTla: string | null;
  opponentName: string;
  home: boolean;
  kickoffUtc: string;
}

/**
 * `fixtures` must already be ordered soonest-first (as `getUpcoming`
 * returns them) — this takes the first fixture it sees for a club and
 * never looks past it, so an unordered list would silently attach the
 * wrong game to a team.
 */
export function nextFixtureByTeam(fixtures: readonly FixtureWithTeams[]): Map<number, UpcomingOpponent> {
  const result = new Map<number, UpcomingOpponent>();
  for (const fixture of fixtures) {
    const { home, away } = fixture;
    // `!= null` (loose), not `!== null`: the type says `TeamLite | null`,
    // never `undefined`, but a value arriving from an API response is worth
    // guarding against both regardless of what the type claims — an
    // unresolved embed that comes back `undefined` rather than `null` would
    // otherwise sail past a strict `!== null` check straight into `.id`.
    if (home != null && !result.has(home.id)) {
      result.set(home.id, {
        opponentTla: away?.tla ?? null,
        opponentName: away?.short_name ?? away?.name ?? 'TBC',
        home: true,
        kickoffUtc: fixture.kickoff_utc,
      });
    }
    if (away != null && !result.has(away.id)) {
      result.set(away.id, {
        opponentTla: home?.tla ?? null,
        opponentName: home?.short_name ?? home?.name ?? 'TBC',
        home: false,
        kickoffUtc: fixture.kickoff_utc,
      });
    }
  }
  return result;
}
