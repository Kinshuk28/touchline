import type { FixtureWithTeams } from '@/lib/site/rows';

/**
 * EDITORIAL SELECTION — NOT DERIVED FROM DATA.
 *
 * There is no popularity, engagement or attendance data anywhere in this
 * database, and this file must never grow one. This is a hand-curated list
 * of well-known clubs across the five leagues this site covers, used only
 * to feature a short, honestly-labelled "Selected fixtures" section on the
 * landing page (see app/page.tsx). `/scores` and `/calendar` are
 * unaffected — they keep showing every fixture, unfiltered.
 *
 * Keyed by football-data.org's `fd_id` (`teams.fd_id`), looked up directly
 * from the production database rather than guessed — see
 * .superpowers/sdd/news-and-fixtures-report.md for the query and the full
 * name next to each id below.
 */
export const MARQUEE_CLUB_FD_IDS: readonly number[] = [
  // La Liga (league_id 15 / fd_code PD)
  86,  // Real Madrid CF
  81,  // FC Barcelona
  78,  // Club Atlético de Madrid
  559, // Sevilla FC

  // Premier League (league_id 14 / fd_code PL)
  66,  // Manchester United FC
  65,  // Manchester City FC
  64,  // Liverpool FC
  57,  // Arsenal FC
  61,  // Chelsea FC
  73,  // Tottenham Hotspur FC

  // Bundesliga (league_id 17 / fd_code BL1)
  5,   // FC Bayern München
  4,   // Borussia Dortmund
  3,   // Bayer 04 Leverkusen

  // Serie A (league_id 16 / fd_code SA)
  109, // Juventus FC
  98,  // AC Milan
  108, // FC Internazionale Milano (Inter)
  113, // SSC Napoli
  100, // AS Roma

  // Ligue 1 (league_id 18 / fd_code FL1)
  524, // Paris Saint-Germain FC
  516, // Olympique de Marseille
  523, // Olympique Lyonnais
  548, // AS Monaco FC
];

const MARQUEE_SET = new Set(MARQUEE_CLUB_FD_IDS);

/** Whether a team's `fd_id` is on the curated marquee list above. */
export function isMarqueeClubId(fdId: number | null | undefined): boolean {
  return fdId != null && MARQUEE_SET.has(fdId);
}

function involvesMarqueeClub(fixture: FixtureWithTeams): boolean {
  return isMarqueeClubId(fixture.home?.fd_id) || isMarqueeClubId(fixture.away?.fd_id);
}

/**
 * The landing page's "Selected fixtures" pick: the soonest `count` fixtures
 * involving at least one marquee club, in chronological order. `fixtures`
 * is assumed already ascending by kickoff (true of every caller —
 * `getUpcoming`), which is what lets this run in one pass rather than
 * re-deriving order from timestamps.
 *
 * Fallback (spec: "if fewer than 8 qualify in the window, top up with the
 * soonest remaining fixtures so the section is never thin or empty"): if
 * fewer than `count` fixtures qualify, the remaining slots are filled with
 * the soonest fixtures that didn't — never invented, just real fixtures
 * that happen not to involve a marquee club. The final list is always
 * re-sorted chronologically, since the top-up pass can interleave a
 * non-marquee fixture ahead of a later-kicking marquee one.
 */
export function selectMarqueeFixtures(
  fixtures: readonly FixtureWithTeams[],
  count = 8,
): FixtureWithTeams[] {
  const chosen: FixtureWithTeams[] = [];
  const chosenIds = new Set<number>();

  for (const fixture of fixtures) {
    if (chosen.length >= count) break;
    if (involvesMarqueeClub(fixture)) {
      chosen.push(fixture);
      chosenIds.add(fixture.id);
    }
  }

  if (chosen.length < count) {
    for (const fixture of fixtures) {
      if (chosen.length >= count) break;
      if (!chosenIds.has(fixture.id)) {
        chosen.push(fixture);
        chosenIds.add(fixture.id);
      }
    }
  }

  return [...chosen].sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
}
