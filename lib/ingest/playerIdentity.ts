import { slugify } from '@/lib/db/slug';

/**
 * Reconciles the two disjoint player-identity paths this project writes:
 * football-data.org (`fd_id`, full squads + top scorers, no photos) and the
 * FPL API (`fpl_id`, Premier League depth stats + photos, no club
 * relationship of its own). Before this module existed, `scripts/ingest/
 * players.ts` inserted a brand-new `players` row for every FPL element with
 * `team_id: null`, because `onConflict: 'fpl_id'` can never match a row
 * whose `fpl_id` is NULL — Postgres treats NULLs as distinct in a unique
 * index — so it never landed on the football-data row for the same human
 * being. Every Premier League player ended up with two rows: one with a club
 * and no stats/photo, one with stats/photo and no club.
 *
 * This module now covers only the first half of that fix: mapping each of
 * the 20 FPL team ids onto our existing `teams.id` for that club, by
 * normalised name (`matchFplTeamsToClubs`). The second half — matching an
 * FPL player onto an *existing* football-data player row — moved to
 * `lib/ingest/playerMatch.ts` (`matchPlayersTiered`), because a plain
 * normalised-full-name join under-matched badly: FPL's `first_name +
 * second_name` is the player's full legal name, while football-data stores
 * the display name a broadcast graphic would use ("David Raya Martín" vs
 * "David Raya"). See that module's doc comment for the tiered, club-scoped
 * replacement.
 */

export interface FplTeamRef {
  fplId: number;
  name: string;
  shortName: string;
}

export interface ClubRef {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
}

export interface FplTeamMatchResult {
  /** FPL team id -> our internal teams.id */
  teamIdByFplTeamId: Map<number, number>;
  unmatched: FplTeamRef[];
}

// A handful of tokens that only ever appear as a club-name *suffix/prefix*
// convention (football-data.org's "<Name> FC" / "AFC <Name>"), never as part
// of what actually distinguishes one club from another. Stripping them
// before comparison is normalisation, not fuzzy matching: "Arsenal FC" and
// "Arsenal" name the same, single club with 100% certainty, unlike a
// same-name-different-person guess.
const CLUB_SUFFIX_TOKENS = new Set(['fc', 'afc', 'cf']);

export function normaliseClubName(name: string): string {
  return slugify(name)
    .split('-')
    .filter((token) => token.length > 0 && !CLUB_SUFFIX_TOKENS.has(token))
    .join('-');
}

/**
 * Matches FPL's 20 Premier League clubs against our stored club rows.
 *
 * football-data.org and FPL do not share a naming convention — football-data
 * gives full legal names ("Manchester City FC"), FPL gives fan-facing short
 * names ("Man City") that frequently aren't even a substring of the full
 * name ("Spurs" vs "Tottenham Hotspur FC"). Comparing normalised full names
 * alone therefore under-matches badly. What both providers *do* share is a
 * short code — football-data's `tla` and FPL's `shortName` are both
 * three-letter club codes drawn from the same real-world footballing
 * convention — so every club contributes candidate keys from its full name,
 * its short name, and its code, and a match on any one of them counts.
 *
 * This can still fail honestly: football-data's `tla` and FPL's
 * `short_name` are maintained independently and occasionally disagree (e.g.
 * Nottingham Forest: football-data's `NOT` vs FPL's `NFO`) — such a club is
 * reported in `unmatched`, not guessed at.
 */
export function matchFplTeamsToClubs(fplTeams: readonly FplTeamRef[], clubs: readonly ClubRef[]): FplTeamMatchResult {
  const clubIdByKey = new Map<string, number>();
  for (const club of clubs) {
    for (const key of clubCandidateKeys(club)) {
      clubIdByKey.set(key, club.id);
    }
  }

  const teamIdByFplTeamId = new Map<number, number>();
  const unmatched: FplTeamRef[] = [];
  for (const team of fplTeams) {
    const key = [normaliseClubName(team.name), normaliseClubName(team.shortName), slugify(team.shortName)].find(
      (k) => clubIdByKey.has(k),
    );
    const clubId = key === undefined ? undefined : clubIdByKey.get(key);
    if (clubId === undefined) {
      unmatched.push(team);
    } else {
      teamIdByFplTeamId.set(team.fplId, clubId);
    }
  }
  return { teamIdByFplTeamId, unmatched };
}

function clubCandidateKeys(club: ClubRef): string[] {
  const keys = [normaliseClubName(club.name)];
  if (club.shortName) keys.push(normaliseClubName(club.shortName));
  if (club.tla) keys.push(slugify(club.tla));
  return keys;
}
