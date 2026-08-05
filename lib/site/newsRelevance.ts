import type { NewsRow } from '@/lib/site/rows';
import { isPromoTitle } from '@/lib/site/promoTitles';

/**
 * News relevance — the landing page's worst content bug, named in
 * docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md: the
 * deployed site led with "Vozinha granted shirt name exemption by Chile
 * FA". The RSS feeds are global football; this site covers the top five
 * European leagues only, and nothing filtered for that.
 *
 * The rule the spec gives: a headline is relevant if it mentions one of the
 * 110 stored clubs (`teams.name`, `short_name`, `tla`). This module is that
 * rule, as a pure function over club names the caller supplies — it never
 * queries, so it is trivially unit-testable and can be reused by any page
 * that renders news.
 *
 * WORD BOUNDARIES, NEVER SUBSTRINGS. This project has shipped the
 * substring bug twice ("nice" inside "Hornicek", "acl" inside
 * "spectacle"), so matching here is done on *tokenised* text: the title is
 * split into word tokens and a club alias matches only as a complete,
 * contiguous run of whole tokens. There is no `String.includes` and no
 * unanchored regex anywhere below.
 */

/** The three name columns this matcher reads. Any row shape carrying them works — `TeamLite`, `ClubRow`. */
export interface ClubNameSource {
  name: string;
  short_name: string | null;
  tla: string | null;
}

/**
 * Club-form tokens that carry no identity: legal/organisational prefixes
 * and suffixes ("FC", "AC", "SSC", "RCD"), the founding-year numbers German
 * and Italian clubs put in their names ("Bayer 04 Leverkusen", "1. FSV
 * Mainz 05"), and connecting words ("Club Atlético *de* Madrid").
 *
 * Dropping them is what turns a stored name into the string a headline
 * actually uses — "AS Roma" into "Roma", "Bayer 04 Leverkusen" into "Bayer
 * Leverkusen". They are dropped from anywhere in the alias, not just the
 * ends, because they occur in all three positions across the 110 stored
 * names. Numbers are dropped wholesale by the digit test in
 * `aliasTokens`, so no year needs listing here.
 */
const NOISE_TOKENS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'ud', 'cd', 'sd', 'rc', 'rcd', 'rcs',
  'sv', 'tsv', 'vfl', 'vfb', 'tsg', 'fsv', 'bsc', 'sco', 'ogc', 'losc', 'fco',
  'calcio', 'club', 'de', 'del', 'di', 'da', 'du', 'des', 'e', 'v', 'ev',
]);

/**
 * The subset of `NOISE_TOKENS` that is also dropped from the *headline*
 * before phrase matching — connecting particles only.
 *
 * Stripping them from the stored name alone isn't enough: "Club Atlético de
 * Madrid" indexes as `atletico madrid`, and a headline writing it out in
 * full ("Atlético de Madrid draw at home") would then fail the
 * contiguous-run test on the intervening "de". Symmetry fixes that.
 *
 * Deliberately *not* the whole noise list: "as", "us" and "e" are ordinary
 * English words, and removing them from a headline would splice unrelated
 * words into adjacency ("Manchester, as United fans feared") and
 * manufacture a phrase match that isn't there. Particles carry no such
 * risk — no English headline's meaning hinges on "de" or "del".
 */
const CONNECTOR_TOKENS = new Set(['de', 'del', 'di', 'da', 'du', 'des']);

/**
 * A club alias, prepared for matching. `tokens` is the normalised
 * (lower-case, diacritic-stripped) form used for the token-run comparison;
 * `display` keeps the alias's own capitalisation, which is what the
 * single-token case-sensitivity rule below compares against.
 */
interface Alias {
  tokens: string[];
  display: string[];
}

export interface ClubIndex {
  /** Multi-token aliases — matched case-insensitively. */
  phrases: Alias[];
  /** Single-token aliases — matched case-sensitively (see `isRelevantHeadline`). */
  singles: Alias[];
  /** Three-letter codes, matched as a case-sensitive whole token. */
  tlas: Set<string>;
}

/** Lower-cased, diacritic-stripped, punctuation-split word tokens. `"Bayer 04 Leverkusen"` → `['bayer', '04', 'leverkusen']`. */
function normalizeTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Same split, capitalisation preserved — the form a case-sensitive comparison needs. */
function caseTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Turns one stored name into an alias, or `null` if nothing identifying
 * survives. Noise tokens and bare numbers are dropped
 * (`NOISE_TOKENS`); a one-letter remainder is discarded outright rather
 * than matched, since a single letter is never a usable club reference.
 */
function toAlias(raw: string | null | undefined): Alias | null {
  if (!raw) return null;
  const lower = normalizeTokens(raw);
  const cased = caseTokens(raw);
  if (lower.length !== cased.length) return null; // defensive: the two splits disagreed, don't guess
  const tokens: string[] = [];
  const display: string[] = [];
  for (let i = 0; i < lower.length; i += 1) {
    const token = lower[i]!;
    if (NOISE_TOKENS.has(token)) continue;
    if (/^[0-9]+$/.test(token)) continue;
    tokens.push(token);
    display.push(cased[i]!);
  }
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && tokens[0]!.length < 3) return null;
  return { tokens, display };
}

function aliasKey(alias: Alias): string {
  return alias.tokens.join(' ');
}

/**
 * Builds the matcher from the stored clubs. Cheap enough (110 rows, a few
 * hundred short strings) to do per request alongside the queries that need
 * it; no caching, so a newly ingested club is matchable immediately.
 */
export function buildClubIndex(clubs: readonly ClubNameSource[]): ClubIndex {
  const phrases = new Map<string, Alias>();
  const singles = new Map<string, Alias>();
  const tlas = new Set<string>();

  for (const club of clubs) {
    for (const raw of [club.name, club.short_name]) {
      const alias = toAlias(raw);
      if (!alias) continue;
      const target = alias.tokens.length > 1 ? phrases : singles;
      // First writer wins: `name` before `short_name`, so a club whose two
      // forms normalise identically keeps one entry, not two.
      if (!target.has(aliasKey(alias))) target.set(aliasKey(alias), alias);
    }
    // A TLA is only a TLA if it looks like one — three upper-case letters.
    // Anything else stored in that column is ignored rather than matched
    // loosely.
    if (club.tla && /^[A-Z]{3}$/.test(club.tla)) tlas.add(club.tla);
  }

  return { phrases: [...phrases.values()], singles: [...singles.values()], tlas };
}

/** Whether `needle` appears in `haystack` as a contiguous run of whole tokens. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Does this headline mention one of the stored clubs?
 *
 * Three matching rules, deliberately different in strictness:
 *
 * - **Multi-token aliases** ("Manchester United", "Real Madrid", "Bayer
 *   Leverkusen") match case-insensitively. Two or more specific words in a
 *   row is already a strong signal; nothing else reads that way by accident.
 * - **Single-token aliases** ("Arsenal", "Napoli", "Nice", "Lens") match
 *   **case-sensitively**. Several clubs' one-word names are also ordinary
 *   English or French words — Nice, Lens, Como, Metz — and a
 *   case-insensitive single-word match would call "a nice win for the
 *   manager" a Ligue 1 story. Headlines always capitalise a club name, so
 *   requiring the alias's own capitalisation costs almost nothing and
 *   removes that whole class of false positive.
 * - **TLAs** ("PSG", "BVB") match as a case-sensitive whole token, for the
 *   same reason.
 *
 * Title only — the spec's rule is about the headline. `summary` is not
 * consulted, so a story whose headline names no club is not promoted on the
 * strength of body text the rail never shows.
 */
export function isRelevantHeadline(title: string, index: ClubIndex): boolean {
  const lower = normalizeTokens(title);
  if (lower.length === 0) return false;
  // Second haystack with connecting particles removed — see CONNECTOR_TOKENS.
  const compact = lower.filter((t) => !CONNECTOR_TOKENS.has(t));

  for (const alias of index.phrases) {
    if (containsRun(lower, alias.tokens) || containsRun(compact, alias.tokens)) return true;
  }

  const cased = caseTokens(title);
  for (const alias of index.singles) {
    if (containsRun(cased, alias.display)) return true;
  }
  for (const token of cased) {
    if (index.tlas.has(token)) return true;
  }
  return false;
}

/**
 * Rank tiers for the landing rails — lower is better. Relevance dominates
 * (that is the bug being fixed), and promo/meta titles ("Get live score
 * updates ... on your lock screen", which really did lead the deployed
 * site) sink within their tier rather than being dropped: a feed of nothing
 * but promos still fills the rail.
 */
function rank(item: Pick<NewsRow, 'title'>, index: ClubIndex): 0 | 1 | 2 | 3 {
  const relevant = isRelevantHeadline(item.title, index);
  const promo = isPromoTitle(item.title);
  if (relevant && !promo) return 0;
  if (relevant && promo) return 1;
  if (!relevant && !promo) return 2;
  return 3;
}

/**
 * Orders news for display: relevant first, recency preserved inside each
 * tier. Nothing is ever discarded — a feed with no top-five story still
 * returns items, in their original (newest-first) order, so a rail is never
 * empty. That is the spec's "fall back to recency when nothing is relevant,
 * never an empty rail", expressed as an ordering rather than a filter.
 *
 * Stable by construction: items are bucketed in input order and the buckets
 * concatenated, rather than passed through a comparator sort (`Array#sort`
 * is stable in modern V8, but bucketing states the intent instead of
 * relying on it).
 *
 * Generic over the row type so `TransferNewsRow` (which carries an extra
 * `league_id`) keeps its own type through the call.
 */
export function orderByRelevance<T extends Pick<NewsRow, 'title'>>(
  items: readonly T[],
  index: ClubIndex,
  limit?: number,
): T[] {
  const buckets: T[][] = [[], [], [], []];
  for (const item of items) buckets[rank(item, index)]!.push(item);
  const ordered = buckets.flat();
  return limit === undefined ? ordered : ordered.slice(0, limit);
}
