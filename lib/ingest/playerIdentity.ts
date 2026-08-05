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
 * A single, hand-verified exception for one confirmed provider-naming clash
 * that no normalisation rule closes: FPL names this club "Nott'm Forest"
 * (short code "NFO"); football-data.org — and this project's stored
 * `teams.name` — call it "Nottingham Forest FC" (tla "NOT"). Neither the
 * full name ("nott-m-forest" vs "nottingham-forest" after stripping the FC
 * suffix) nor the short code overlaps, so `clubCandidateKeys` never
 * produces a shared key for this one club, and it silently falls into
 * `unmatched` on every run — orphaning its entire squad from `team_id` in
 * `scripts/ingest/players.ts` (23 players and growing each run, confirmed
 * live).
 *
 * This is intentionally one hardcoded entry, keyed on FPL's exact team
 * name, not a general alias table and not fuzzy matching — a prior attempt
 * at fuzzy name matching produced false positives on generic shared tokens
 * (e.g. "city" matching several unrelated clubs at once), which is
 * strictly worse than this function's honest "unmatched" for every other
 * genuine mismatch. Add another entry here only once a *specific* provider
 * mismatch is confirmed the same way this one was (see
 * tests/ingest/playerIdentity.test.ts's "Nottingham Forest exception"
 * block) — never as a speculative general-purpose lookup.
 */
const FPL_TEAM_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  "nott'm forest": 'nottingham forest fc',
};

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
 * `FPL_TEAM_NAME_EXCEPTIONS` is checked first, ahead of the candidate-key
 * lookup, for the one club (Nottingham Forest) where football-data's `tla`
 * and FPL's `short_name` disagree outright — see that constant's doc
 * comment. Every other mismatch still fails honestly: reported in
 * `unmatched`, never guessed at.
 */
export function matchFplTeamsToClubs(fplTeams: readonly FplTeamRef[], clubs: readonly ClubRef[]): FplTeamMatchResult {
  const clubIdByKey = new Map<string, number>();
  const clubIdByExactName = new Map<string, number>();
  for (const club of clubs) {
    for (const key of clubCandidateKeys(club)) {
      clubIdByKey.set(key, club.id);
    }
    clubIdByExactName.set(club.name.trim().toLowerCase(), club.id);
  }

  const teamIdByFplTeamId = new Map<number, number>();
  const unmatched: FplTeamRef[] = [];
  for (const team of fplTeams) {
    const exceptionClubName = FPL_TEAM_NAME_EXCEPTIONS[team.name.trim().toLowerCase()];
    const exceptionClubId = exceptionClubName === undefined ? undefined : clubIdByExactName.get(exceptionClubName);

    const key = [normaliseClubName(team.name), normaliseClubName(team.shortName), slugify(team.shortName)].find(
      (k) => clubIdByKey.has(k),
    );
    const clubId = exceptionClubId ?? (key === undefined ? undefined : clubIdByKey.get(key));
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
