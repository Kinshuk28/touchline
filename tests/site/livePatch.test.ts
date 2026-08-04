import { describe, it, expect } from 'vitest';
import { mergeLiveFixtures, hasLiveChanges, parseLiveResponse } from '@/lib/site/livePatch';
import type { FixtureWithTeams } from '@/lib/site/rows';

const base: FixtureWithTeams = {
  id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
  status: 'IN_PLAY', matchday: 1, home_goals: 0, away_goals: 0,
  updated_at: '2026-08-16T14:30:00Z',
  home: { id: 10, slug: 'a', name: 'A', short_name: 'A', tla: 'AAA', crest_url: null },
  away: { id: 11, slug: 'b', name: 'B', short_name: 'B', tla: 'BBB', crest_url: null },
};

describe('mergeLiveFixtures', () => {
  it('updates the score of a matching fixture', () => {
    const out = mergeLiveFixtures([base], [{ ...base, home_goals: 1 }]);
    expect(out[0]!.home_goals).toBe(1);
  });

  it('preserves joined team data the server still sends back', () => {
    const patched = { ...base, home_goals: 2, away_goals: 1 };
    const out = mergeLiveFixtures([base], [patched]);
    expect(out[0]!.home!.name).toBe('A');
    expect(out[0]!.away!.slug).toBe('b');
  });

  it('leaves an unchanged fixture untouched, by identity', () => {
    const other = { ...base, id: 2 };
    const changed = { ...base, home_goals: 3 };
    const out = mergeLiveFixtures([base, other], [changed, other]);
    expect(out.find((f) => f.id === 2)).toBe(other);
  });

  it('appends a fixture the page has not seen yet', () => {
    const kickedOff: FixtureWithTeams = {
      ...base,
      id: 42,
      kickoff_utc: '2026-08-16T15:00:00Z',
      home: { id: 20, slug: 'c', name: 'C', short_name: 'C', tla: 'CCC', crest_url: null },
      away: { id: 21, slug: 'd', name: 'D', short_name: 'D', tla: 'DDD', crest_url: null },
    };
    const out = mergeLiveFixtures([base], [base, kickedOff]);
    expect(out.some((f) => f.id === 42)).toBe(true);
    expect(out.find((f) => f.id === 42)?.home?.name).toBe('C');
  });

  it('removes a fixture the server no longer returns', () => {
    const other = { ...base, id: 2 };
    const out = mergeLiveFixtures([base, other], [base]);
    expect(out.some((f) => f.id === 2)).toBe(false);
    expect(out).toHaveLength(1);
  });

  it('carries a status transition through to full time', () => {
    const out = mergeLiveFixtures([base], [{ ...base, status: 'FINISHED', home_goals: 2, away_goals: 2 }]);
    expect(out[0]!.status).toBe('FINISHED');
  });

  it('accepts a null score without coercing it to zero', () => {
    const out = mergeLiveFixtures([base], [{ ...base, status: 'POSTPONED', home_goals: null, away_goals: null }]);
    expect(out[0]!.home_goals).toBeNull();
  });

  it('keeps the result ordered by kickoff_utc ascending, matching the server', () => {
    const earlier: FixtureWithTeams = { ...base, id: 99, kickoff_utc: '2026-08-16T12:00:00Z' };
    const out = mergeLiveFixtures([base], [base, earlier]);
    expect(out.map((f) => f.id)).toEqual([99, 1]);
  });

  // --- Finding 1 (CRITICAL): /api/live returned every league, unscoped, and
  // nothing carried the page's ?leagues= filter into the poll loop. These
  // three cases pin the defensive filter mergeLiveFixtures now applies to
  // `incoming` via `allowedLeagueIds` — the last line of defence even though
  // the real fix is `/api/live` scoping its query. Written and confirmed RED
  // against the pre-fix two-argument mergeLiveFixtures (see task-5-report.md).
  describe('league scoping (Finding 1)', () => {
    const otherLeague: FixtureWithTeams = { ...base, id: 2, league_id: 2 };

    it('excludes a league the page did not ask for', () => {
      const out = mergeLiveFixtures([], [base, otherLeague], [1]);
      expect(out.map((f) => f.id)).toEqual([1]);
    });

    it('an unknown league id set yields no fixtures, not all fixtures', () => {
      const out = mergeLiveFixtures([], [base, otherLeague], []);
      expect(out).toEqual([]);
    });

    it('no league filter yields everything, unchanged from today', () => {
      const out = mergeLiveFixtures([], [base, otherLeague]);
      expect(out.map((f) => f.id).sort()).toEqual([1, 2]);
    });
  });
});

// Finding 2 (IMPORTANT): the "identity means React skips the row" comment
// was aspirational, not true — ScoreRow wasn't memoised and `now` was
// rethreaded fresh into every row on every successful poll, changed or not.
// `hasLiveChanges` is the piece LiveScores now uses to skip setState (and
// therefore skip handing rows a fresh `now`) on a poll that changed nothing.
// This is the part of the fix that's assertable without a DOM: the actual
// no-re-render behaviour also depends on `ScoreRow` being wrapped in
// `React.memo` and `now` being replaced by a parent-computed `scoreText`
// prop (components/ScoreRow.tsx, components/LiveScores.tsx), which there is
// no jsdom/testing-library setup in this project to exercise directly.
describe('hasLiveChanges', () => {
  it('a poll returning identical data produces no state change', () => {
    const current = [base, { ...base, id: 2 }];
    // Simulates a real poll: the server sends back exactly the same rows
    // (new objects, same values) it sent before, exactly as a healthy 120s
    // poll usually does. mergeLiveFixtures preserves identity for each
    // unchanged row, so the merged array must compare unchanged too.
    const incoming = current.map((f) => ({ ...f }));
    const merged = mergeLiveFixtures(current, incoming);
    expect(hasLiveChanges(current, merged)).toBe(false);
    // The stronger, load-bearing property: not just equal by value, but the
    // exact same object references LiveScores would compare props against.
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]).toBe(current[1]);
  });

  it('a poll that changes one fixture is reported as a change', () => {
    const current = [base, { ...base, id: 2 }];
    const merged = mergeLiveFixtures(current, [{ ...base, home_goals: 9 }, { ...base, id: 2 }]);
    expect(hasLiveChanges(current, merged)).toBe(true);
  });

  it('a poll that adds a new fixture is reported as a change', () => {
    const current = [base];
    const merged = mergeLiveFixtures(current, [base, { ...base, id: 2 }]);
    expect(hasLiveChanges(current, merged)).toBe(true);
  });
});

// Finding 3 (MINOR): fetchLive() caught network/parse errors but not a
// structurally malformed, validly-parsed JSON body — plausible during a
// rolling deploy with client/server version skew. That reached
// mergeLiveFixtures(prev, body.fixtures), whose `.map()`/`.filter()` on a
// non-array throws inside the setFixtures updater, uncaught. A bad shape
// must be ignored exactly like a failed request.
describe('parseLiveResponse', () => {
  it('accepts a well-formed response', () => {
    const body = { now: '2026-08-16T14:00:00Z', fixtures: [base] };
    expect(parseLiveResponse(body)).toEqual(body);
  });

  it('rejects a response whose fixtures field is not an array', () => {
    expect(parseLiveResponse({ now: '2026-08-16T14:00:00Z', fixtures: { 0: base } })).toBeNull();
  });

  it('rejects a response missing fixtures entirely', () => {
    expect(parseLiveResponse({ now: '2026-08-16T14:00:00Z' })).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(parseLiveResponse(null)).toBeNull();
    expect(parseLiveResponse('fixtures')).toBeNull();
    expect(parseLiveResponse(42)).toBeNull();
  });

  it('rejects a response whose now field is not a string', () => {
    expect(parseLiveResponse({ now: null, fixtures: [] })).toBeNull();
  });
});
