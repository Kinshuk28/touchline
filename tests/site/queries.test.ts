import { describe, it, expect, vi } from 'vitest';
import { buildFixtureSelect, LIVE_STATUSES, RECENT_WINDOW_HOURS } from '@/lib/site/queries/fixtures';

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

describe('live status set', () => {
  it('treats IN_PLAY and PAUSED as live', () => {
    expect(LIVE_STATUSES).toContain('IN_PLAY');
    expect(LIVE_STATUSES).toContain('PAUSED');
  });

  it('does not treat FINISHED as live', () => {
    expect(LIVE_STATUSES).not.toContain('FINISHED');
  });

  it('keeps a recent window wide enough to cover a full match plus stoppage', () => {
    expect(RECENT_WINDOW_HOURS).toBeGreaterThanOrEqual(3);
  });
});
