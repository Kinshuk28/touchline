/**
 * Title patterns that mark a story as a product promo or meta piece rather
 * than actual football news — e.g. "Get live score updates for your
 * football team on your lock screen for 2026-27", which briefly led the
 * real site: newest-first with no quality signal, `getTrendingNews` had no
 * way to know that wasn't a story.
 *
 * This file was `lib/site/leadStory.ts` until the landing page stopped
 * having a lead story (the dashboard rebuild kills the hero — see
 * docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md). The
 * hero-selection function went with the hero; the promo-title knowledge is
 * still worth keeping, and now demotes these inside the news rail's
 * ordering instead (lib/site/newsRelevance.ts#orderByRelevance).
 */
const PROMO_TITLE_PATTERNS: readonly RegExp[] = [
  /^get /i,
  /^how to follow/i,
  /^watch:/i,
  /^listen:/i,
  /^follow live/i,
  /on your lock screen/i,
];

/** Whether a headline is a promo/meta piece rather than a story. Never used to *drop* an item — only to sink it below real stories. */
export function isPromoTitle(title: string): boolean {
  return PROMO_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}
