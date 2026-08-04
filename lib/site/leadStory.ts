import type { NewsRow } from '@/lib/site/rows';

/**
 * Title patterns that mark a story as a product promo or meta piece rather
 * than actual football news — e.g. "Get live score updates for your
 * football team on your lock screen for 2026-27", which briefly led the
 * real site: newest-first with no quality signal, `getTrendingNews` had no
 * way to know that wasn't a story. None of these belong in the hero slot,
 * the single largest, most prominent element on the page — even one that
 * happens to carry an image.
 */
const PROMO_TITLE_PATTERNS: readonly RegExp[] = [
  /^get /i,
  /^how to follow/i,
  /^watch:/i,
  /^listen:/i,
  /^follow live/i,
  /on your lock screen/i,
];

function isPromoTitle(title: string): boolean {
  return PROMO_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * Ranks a hero candidate — lower is better — on two independent signals,
 * in priority order:
 *
 * 1. Has an image. A hero without one is the weakest possible version, so
 *    this dominates every other factor.
 * 2. Isn't a promo/meta title. These aren't stories and must never lead,
 *    even if one happens to carry an image.
 */
function rank(item: NewsRow): 0 | 1 | 2 | 3 {
  const hasImage = item.image_url !== null;
  const promo = isPromoTitle(item.title);
  if (hasImage && !promo) return 0;
  if (hasImage && promo) return 1;
  if (!hasImage && !promo) return 2;
  return 3;
}

/**
 * Picks the landing page's hero story out of `getTrendingNews`'s
 * newest-first result. Selection only — this never rewrites, rewords or
 * invents a headline, it just chooses which fetched item leads. The news
 * grid itself stays purely chronological; this is a hero-slot-only concern.
 *
 * Every item is *ranked*, never discarded outright — `rank` always returns
 * a value for every item — so a feed where every candidate is a promo with
 * no image still yields a hero (the best-ranked, i.e. newest, item among
 * them) rather than no hero at all.
 *
 * Pure and presumes `items` is already newest-first (true of every current
 * caller, `getTrendingNews`): within a rank tier this never re-sorts by
 * date, so "prefer recency among remaining candidates" falls out of a
 * strict `<` comparison below — the first item to reach a given rank wins
 * ties against a later, same-ranked item, and "first" only means "newest"
 * because the input already arrived in that order.
 */
export function selectLeadStory(items: readonly NewsRow[]): NewsRow | undefined {
  let best: NewsRow | undefined;
  let bestRank = 4;
  for (const item of items) {
    const r = rank(item);
    if (r < bestRank) {
      best = item;
      bestRank = r;
    }
  }
  return best;
}
