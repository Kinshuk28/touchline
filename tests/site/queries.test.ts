import { describe, it, expect } from 'vitest';
import { buildFixtureSelect, isLiveOrRecent, RECENT_WINDOW_HOURS } from '@/lib/site/queries/fixtures';

describe('fixture select', () => {
  it('joins both teams so a crest never needs a second query', () => {
    const sel = buildFixtureSelect();
    expect(sel).toContain('home:home_team_id');
    expect(sel).toContain('away:away_team_id');
    expect(sel).toContain('crest_url');
    expect(sel).toContain('slug');
  });

  it('requests updated_at so pages can show data age honestly', () => {
    expect(buildFixtureSelect()).toContain('updated_at');
  });
});

// Pins the decision rule behind getLiveAndRecent, not the shape of any exported
// constant — a status/time combination is either "live or recent" or it isn't,
// and that's what these tests assert against a pure function, no database needed.
describe('isLiveOrRecent', () => {
  const now = new Date('2026-08-04T18:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

  it('IN_PLAY 20 minutes after kickoff is live', () => {
    expect(isLiveOrRecent('IN_PLAY', minutesAgo(20), now)).toBe(true);
  });

  // The false-negative case: a match suspended for weather/floodlights and resumed
  // hours later must not vanish from the feed just because kickoff is outside the
  // recent-finished window. Being IN_PLAY is the strongest possible signal and must
  // win regardless of elapsed time.
  it('IN_PLAY 9 hours after kickoff (long suspension, resumed) is still live', () => {
    expect(isLiveOrRecent('IN_PLAY', hoursAgo(9), now)).toBe(true);
  });

  it('PAUSED at half time is live', () => {
    expect(isLiveOrRecent('PAUSED', minutesAgo(50), now)).toBe(true);
  });

  it('FINISHED 2 hours after kickoff is recent', () => {
    expect(isLiveOrRecent('FINISHED', hoursAgo(2), now)).toBe(true);
  });

  it('FINISHED 3 days ago is not recent', () => {
    expect(isLiveOrRecent('FINISHED', daysAgo(3), now)).toBe(false);
  });

  // The false-positive case: a postponed fixture keeps its original kickoff_utc,
  // which can easily fall inside the recent window even though nothing is playing.
  it('POSTPONED with a kickoff 1 hour ago is never shown', () => {
    expect(isLiveOrRecent('POSTPONED', hoursAgo(1), now)).toBe(false);
  });

  it('CANCELLED with a kickoff 1 hour ago is never shown', () => {
    expect(isLiveOrRecent('CANCELLED', hoursAgo(1), now)).toBe(false);
  });

  // Note the asymmetry with lib/ingest/matchWindow.ts: Phase A's ingestion guard
  // (isMatchWindowOpen/isLiveRelevant) deliberately keeps polling a SUSPENDED
  // fixture, because it might resume and the write path must not stop fetching it.
  // This function answers a different question — "is this a live score to display
  // right now" — and a suspended match is not a live score, so it is excluded here
  // even though the ingestion side treats SUSPENDED as very much still relevant.
  it('SUSPENDED with a kickoff 1 hour ago is never shown', () => {
    expect(isLiveOrRecent('SUSPENDED', hoursAgo(1), now)).toBe(false);
  });

  it('SCHEDULED in the future is not shown (belongs to the upcoming list)', () => {
    expect(isLiveOrRecent('SCHEDULED', hoursFromNow(2), now)).toBe(false);
  });

  it('TIMED in the future is not shown (belongs to the upcoming list)', () => {
    expect(isLiveOrRecent('TIMED', hoursFromNow(2), now)).toBe(false);
  });

  it('keeps a recent window wide enough to cover a full match plus stoppage', () => {
    expect(RECENT_WINDOW_HOURS).toBeGreaterThanOrEqual(3);
  });
});
