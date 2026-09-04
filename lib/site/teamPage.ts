import type { FixtureWithTeams } from '@/lib/site/rows';

/**
 * Splits one club's fixture list — `getFixturesForTeam` returns past and
 * future in a single ascending call — into the two halves a club page
 * shows: results newest-first, fixtures soonest-first.
 *
 * The cut is made on kickoff time against `now`, not on status, and that is
 * deliberate. Status alone would strand a match whose kickoff has passed
 * but whose ingest hasn't caught up yet (the same gap
 * `lib/site/queries/fixtures.ts`'s grace window exists for): it is neither
 * FINISHED nor upcoming, and a status-based split would drop it from both
 * lists. Time always has an answer.
 *
 * A postponed match keeps its original kickoff, so it sorts by that — into
 * results once the date passes, labelled "Postp." by `spineStateLabel`,
 * which is honest: the date came and went and no match was played.
 */
export function splitTeamFixtures(
  fixtures: readonly FixtureWithTeams[],
  now: Date,
  limits: { results?: number; upcoming?: number } = {},
): { results: FixtureWithTeams[]; upcoming: FixtureWithTeams[] } {
  const nowIso = now.toISOString();
  const past = fixtures.filter((f) => f.kickoff_utc <= nowIso);
  const future = fixtures.filter((f) => f.kickoff_utc > nowIso);

  // Results read backwards from today — the most recent match is the one a
  // reader came for, so it goes first.
  const results = [...past].reverse();

  return {
    results: limits.results === undefined ? results : results.slice(0, limits.results),
    upcoming: limits.upcoming === undefined ? future : future.slice(0, limits.upcoming),
  };
}

/**
 * A club's own record for one season — played, won, drawn, lost, goals for
 * and against — computed only from matches that actually have a score.
 *
 * Deliberately derived here rather than read from `standings`: the
 * standings table is a competition-scoped snapshot from the provider, and a
 * club page's fixture list is the club's own record of the same season,
 * including anything the table doesn't cover. Where both exist they should
 * agree; where they disagree the table is authoritative for the league
 * position, and this is only ever presented as a summary of the matches
 * listed directly below it.
 *
 * `season` is required, not optional: `fixtures` (from
 * `getFixturesForTeam`) spans every season this project has ever stored for
 * the club, not just one — confirmed live on /team/liverpool-fc-64, which
 * showed "Played 40" a few matchdays into a new season because this
 * function used to sum every scored fixture it was handed with no season
 * filter at all, silently adding last season's 38 games to this season's
 * handful. Scoping here, inside the one function every caller must go
 * through, is what makes that bug impossible to reintroduce by accident —
 * a caller that forgets to filter its own fixture list first still gets a
 * single season's record out of this.
 *
 * Returns `null` when nothing has been played in that season — a record of
 * zeros is not a record, it is preseason, and the page says so in words
 * instead.
 */
export interface TeamRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

export function teamRecord(fixtures: readonly FixtureWithTeams[], teamId: number, season: number): TeamRecord | null {
  const record: TeamRecord = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };

  for (const f of fixtures) {
    if (f.season !== season) continue;
    if (f.home_goals === null || f.away_goals === null) continue;
    const isHome = f.home?.id === teamId;
    const isAway = f.away?.id === teamId;
    // A fixture that doesn't involve this club at all cannot contribute —
    // defensive, since the caller queries by team, but a silent
    // miscount here would be invisible and wrong.
    if (!isHome && !isAway) continue;

    const scored = isHome ? f.home_goals : f.away_goals;
    const conceded = isHome ? f.away_goals : f.home_goals;
    record.played += 1;
    record.goalsFor += scored;
    record.goalsAgainst += conceded;
    if (scored > conceded) record.won += 1;
    else if (scored === conceded) record.drawn += 1;
    else record.lost += 1;
  }

  return record.played > 0 ? record : null;
}
