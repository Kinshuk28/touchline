import { describe, it, expect } from 'vitest';
import { isPromoTitle } from '@/lib/site/promoTitles';

// Was tests/site/leadStory.test.ts. The hero — and with it `selectLeadStory`
// — is gone (docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md
// kills the hero outright); the promo-title recognition it was built on
// survives, now demoting these inside the news rail's ordering
// (lib/site/newsRelevance.ts). These are the same cases the selection tests
// asserted, applied directly to the predicate they were really testing.
describe('isPromoTitle', () => {
  it.each([
    'Get live score updates for your football team',
    'How to follow the new season on TV',
    'Watch: the best goals of the week',
    'Listen: this week\'s big preview',
    'Follow live: transfer deadline day',
    'Download the app for updates on your lock screen',
  ])('recognises %j as a promo title', (title) => {
    expect(isPromoTitle(title)).toBe(true);
  });

  it.each([
    'Arsenal close in on deadline-day move',
    'Real Madrid held to a draw at Getafe',
    'Guardiola gets his wish as City sign a defender',
    'Watchdog clears broadcaster over highlights deal',
    'Forget the table — this is a title race',
  ])('does not flag %j', (title) => {
    expect(isPromoTitle(title)).toBe(false);
  });

  it('anchors the "get"/"watch" patterns rather than matching mid-sentence', () => {
    // The bug this guards: an unanchored /get/i would flag any headline
    // containing "get", "forget" or "target".
    expect(isPromoTitle('Nuno targets a fast start after forgettable summer')).toBe(false);
    expect(isPromoTitle('Late goal gets Brentford a point')).toBe(false);
  });
});
