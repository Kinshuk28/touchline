import { slugify } from '@/lib/db/slug';

/**
 * Tiered, club-scoped FPL-to-football-data player matcher.
 *
 * `matchFplPlayersByName` (the plain global exact-name join this module
 * replaces at both call sites) under-matched badly for a specific, now
 * understood reason: FPL's `first_name + second_name` is the player's full
 * *legal* name, while football-data.org stores the *display* name a
 * broadcast graphic would use. The two coincide for plenty of players
 * (Meslier, Timber, Saliba) but diverge constantly for anyone with a
 * Spanish/Portuguese/Brazilian-style compound name:
 *
 *   FPL (full legal name)         football-data (display name)
 *   David Raya Martín        -->  David Raya
 *   Kepa Arrizabalaga Revuelta --> Kepa Arrizabalaga
 *   Gabriel dos Santos Magalhães --> Gabriel Magalhães
 *   Mikel Merino Zazón        --> Mikel Merino
 *
 * FPL also exposes `web_name` — the short display form the game itself
 * shows ("Raya", "Kepa", "Gabriel", "Merino"). A bare surname is hopelessly
 * ambiguous across an entire league (dozens of "Silva"s), which is exactly
 * why this never became an alias table or a fuzzy match: instead, matching
 * is scoped to a single club (~25 players), where a bare surname is nearly
 * always unique.
 *
 * Three tiers are tried in order, strongest signal first; the first tier
 * that narrows the *within-club* candidate list to exactly one player wins:
 *
 *   1. exact       — normalised full name equals a candidate's normalised
 *                    full name (the original signal — still the strongest
 *                    where legal and display names coincide).
 *   2. last-token   — normalised `web_name` equals the last token of a
 *                    candidate's normalised name (surname-only web_names
 *                    against "First Last"-shaped display names).
 *   3. whole-token  — normalised `web_name` equals *any* token of a
 *                    candidate's normalised name (catches "Gabriel" against
 *                    "Gabriel Magalhães", where the shared token isn't
 *                    last).
 *
 * A tier that produces two or more within-club candidates is ambiguous, not
 * resolved — the next tier is tried instead of guessing. If every tier is
 * ambiguous or empty, the subject is reported unmatched. This never crosses
 * a club boundary and never merges two distinct players on a coin flip.
 */

export interface MatchCandidate {
  /** Internal `players.id` of an existing football-data row. */
  id: number;
  /** football-data's display name for this player. */
  name: string;
  /** Internal `teams.id` this candidate currently belongs to. */
  teamId: number;
}

export interface MatchSubject {
  /** FPL's `first_name + second_name` — the full legal name. */
  fullName: string;
  /** FPL's `web_name` — the short in-game display form. */
  webName: string;
  /**
   * Internal `teams.id` this subject's FPL club resolved to, or `undefined`
   * if that club-level resolution itself failed (see
   * `matchFplTeamsToClubs`) — such a subject has no club to scope
   * candidates to and is always reported unmatched, never matched
   * league-wide.
   */
  teamId: number | undefined;
}

export type MatchTier = 'exact' | 'last-token' | 'whole-token';

export interface TieredMatch<T> {
  subject: T;
  playerId: number;
  tier: MatchTier;
}

export interface TieredMatchResult<T> {
  matches: Array<TieredMatch<T>>;
  unmatched: T[];
  /** Count of matches contributed by each tier, for honest reporting. */
  tierCounts: Record<MatchTier, number>;
}

function tokensOf(name: string): string[] {
  return slugify(name)
    .split('-')
    .filter((token) => token.length > 0);
}

export function matchPlayersTiered<T extends MatchSubject>(
  subjects: readonly T[],
  candidates: readonly MatchCandidate[],
): TieredMatchResult<T> {
  const byTeam = new Map<number, MatchCandidate[]>();
  for (const candidate of candidates) {
    const club = byTeam.get(candidate.teamId);
    if (club) club.push(candidate);
    else byTeam.set(candidate.teamId, [candidate]);
  }

  const matches: Array<TieredMatch<T>> = [];
  const unmatched: T[] = [];
  const tierCounts: Record<MatchTier, number> = { exact: 0, 'last-token': 0, 'whole-token': 0 };

  for (const subject of subjects) {
    const club = subject.teamId === undefined ? [] : (byTeam.get(subject.teamId) ?? []);
    const fullSlug = slugify(subject.fullName);
    const webSlug = slugify(subject.webName);

    const exact = club.filter((c) => slugify(c.name) === fullSlug);
    if (exact.length === 1) {
      matches.push({ subject, playerId: exact[0]!.id, tier: 'exact' });
      tierCounts.exact++;
      continue;
    }

    if (webSlug.length > 0) {
      const lastToken = club.filter((c) => {
        const tokens = tokensOf(c.name);
        return tokens.length > 0 && tokens[tokens.length - 1] === webSlug;
      });
      if (lastToken.length === 1) {
        matches.push({ subject, playerId: lastToken[0]!.id, tier: 'last-token' });
        tierCounts['last-token']++;
        continue;
      }

      const wholeToken = club.filter((c) => tokensOf(c.name).includes(webSlug));
      if (wholeToken.length === 1) {
        matches.push({ subject, playerId: wholeToken[0]!.id, tier: 'whole-token' });
        tierCounts['whole-token']++;
        continue;
      }
    }

    unmatched.push(subject);
  }

  return { matches, unmatched, tierCounts };
}
