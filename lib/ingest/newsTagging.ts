import { buildClubIndex, matchingClubIds, type ClubIndex } from '@/lib/site/newsRelevance';

/**
 * Tagging stored news with the clubs and competition it is about — the
 * outstanding Phase B2 item: `news_items.league_id` and `news_items.team_ids`
 * exist in the schema (0001_init.sql) and have never been written.
 *
 * Until now, "news about this club" was computed at render time by matching
 * the headline against every stored club name on every request. That works
 * — /team/[slug] shipped with it — but it cannot be queried: the club page
 * has to fetch 60 headlines and filter them in JavaScript, and a club whose
 * news sits at position 61 has none. Tagging at write time turns it into
 * `where team_ids contains [id]`, which is one indexed query returning
 * exactly that club's stories, however old.
 *
 * IMPORT DIRECTION. This is `lib/ingest/` reading `lib/site/`, which looks
 * backwards but is the only direction allowed: the project rule is that
 * `lib/site/` and `app/` must never import from `lib/db/` or `lib/ingest/`,
 * and it is one-way. The matcher is pure (no queries, no environment) and
 * lives in `lib/site/` because four site call sites use it; duplicating it
 * here so the arrow pointed the other way would mean two implementations of
 * the word-boundary rule this project has already got wrong twice.
 */

/** The club fields tagging needs: identity for matching, `league_id` for the competition. */
export interface TaggableClub {
  id: number;
  name: string;
  short_name: string | null;
  tla: string | null;
  league_id: number | null;
}

export interface NewsTags {
  /** Every stored club the headline names. Empty for a story about football elsewhere. */
  team_ids: number[];
  /**
   * The competition, when every named club plays in the same one. `null`
   * when the clubs span competitions (a Champions League tie between a
   * Premier League and a La Liga club belongs to neither) or when no club
   * was named at all.
   */
  league_id: number | null;
}

export function buildTaggingIndex(clubs: readonly TaggableClub[]): ClubIndex {
  return buildClubIndex(clubs);
}

/**
 * Tags one headline. Pure: the caller supplies the index and the club
 * lookup, so this is unit-testable without a database and cheap enough to
 * run over every item in a batch.
 *
 * A club with no `league_id` (the 14 retained for historical tables) still
 * tags the story — it is genuinely about that club — but contributes no
 * competition, so a story naming only relegated clubs gets `team_ids` and a
 * null `league_id`. That is the honest pair: we know who, we don't know
 * which competition.
 */
export function tagHeadline(
  title: string,
  index: ClubIndex,
  leagueOf: (clubId: number) => number | null,
): NewsTags {
  const team_ids = matchingClubIds(title, index).sort((a, b) => a - b);
  if (team_ids.length === 0) return { team_ids, league_id: null };

  const leagues = new Set(team_ids.map(leagueOf).filter((l): l is number => l !== null));
  return { team_ids, league_id: leagues.size === 1 ? [...leagues][0]! : null };
}

/** `tagHeadline` for a whole batch, with the club lookup built once. */
export function tagHeadlines<T extends { title: string }>(
  items: readonly T[],
  clubs: readonly TaggableClub[],
): Array<T & NewsTags> {
  const index = buildTaggingIndex(clubs);
  const leagueById = new Map(clubs.map((c) => [c.id, c.league_id]));
  const leagueOf = (id: number) => leagueById.get(id) ?? null;
  return items.map((item) => ({ ...item, ...tagHeadline(item.title, index, leagueOf) }));
}
