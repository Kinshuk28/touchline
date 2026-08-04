import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFixtureSelect, isLiveOrRecent, RECENT_WINDOW_HOURS, getUpcoming } from '@/lib/site/queries/fixtures';

// A minimal, hand-rolled stand-in for the PostgREST query builder that
// `readClient()` returns — not a mocking library, just enough chain surface
// (`select`/`gt`/`gte`/`lte`/`in`/`order`/`limit`) plus a `then` so `await`
// works the same way it does on a real Supabase query. This is the "fake
// client" the Finding 1 test brief asks for, kept inline in this file rather
// than as new shared test infrastructure since `getUpcoming` is the only
// thing here that needs a database round trip to exercise.
type FakeRow = Record<string, unknown>;

const fakeDb = vi.hoisted(() => {
  let rows: FakeRow[] = [];

  function makeQuery(source: () => FakeRow[]) {
    const filters: Array<(r: FakeRow) => boolean> = [];
    let orderBy: { col: string; ascending: boolean } | null = null;
    let limitN: number | null = null;

    const api = {
      select(_cols: string) { return api; },
      gt(col: string, v: unknown) { filters.push((r) => (r[col] as string) > (v as string)); return api; },
      gte(col: string, v: unknown) { filters.push((r) => (r[col] as string) >= (v as string)); return api; },
      lte(col: string, v: unknown) { filters.push((r) => (r[col] as string) <= (v as string)); return api; },
      in(col: string, vals: readonly unknown[]) { filters.push((r) => (vals as unknown[]).includes(r[col])); return api; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending ?? true };
        return api;
      },
      limit(n: number) { limitN = n; return api; },
      then<T, U>(
        onFulfilled?: ((v: { data: FakeRow[]; error: null }) => T | PromiseLike<T>) | null,
        onRejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ) {
        let result = source().filter((r) => filters.every((f) => f(r)));
        if (orderBy) {
          const { col, ascending } = orderBy;
          result = [...result].sort((a, b) => {
            const cmp = String(a[col]).localeCompare(String(b[col]));
            return ascending ? cmp : -cmp;
          });
        }
        if (limitN !== null) result = result.slice(0, limitN);
        return Promise.resolve({ data: result, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return {
    setRows(next: FakeRow[]) { rows = next; },
    client: { from: (_table: string) => makeQuery(() => rows) },
  };
});

vi.mock('@/lib/site/supabase', () => ({ readClient: () => fakeDb.client }));

function fixtureRow(overrides: Partial<FakeRow> & { id: number; league_id: number; kickoff_utc: string }): FakeRow {
  return {
    season: 2026,
    status: 'SCHEDULED',
    matchday: null,
    home_goals: null,
    away_goals: null,
    updated_at: overrides.kickoff_utc,
    home: null,
    away: null,
    ...overrides,
  };
}

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

// Finding 1: `/scores` called getUpcoming(now, 20) with no league scoping at
// all, then filtered the 20 rows down to the selected league in JavaScript.
// Once combined near-term fixture volume across the five leagues exceeds 20,
// a league whose fixtures sort past global position 20 gets truncated away
// before the JS filter ever sees them, and the page falsely renders "Nothing
// scheduled" for a league that has real fixtures in the database. This test
// was written and run *before* `getUpcoming` gained a `leagueIds` parameter:
// at that point it failed with `upcoming` at length 0 instead of 5 (extra
// call arguments are silently ignored at runtime, so the unscoped query ran
// exactly as it does in production today) — that failure is the RED proof
// the bug is real, not hypothetical. See .superpowers/sdd/task-6-report.md
// for the captured output. The same test now also serves as the fix's
// regression test: the limit must apply *after* scoping, not before.
describe('getUpcoming scoping (Finding 1)', () => {
  beforeEach(() => fakeDb.setRows([]));

  const now = new Date('2026-08-16T00:00:00Z');
  const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

  it('applies the league filter before the limit, so a scoped page never falsely reports nothing scheduled', async () => {
    const rows: FakeRow[] = [];
    // League 1: 20 fixtures occupying every one of the unscoped top-20 slots.
    for (let i = 0; i < 20; i++) {
      rows.push(fixtureRow({ id: i + 1, league_id: 1, kickoff_utc: hoursFromNow(i + 1) }));
    }
    // League 2: 5 real fixtures, all ranked *after* league 1's, entirely
    // past the unscoped top-20 cutoff.
    for (let i = 0; i < 5; i++) {
      rows.push(fixtureRow({ id: 100 + i, league_id: 2, kickoff_utc: hoursFromNow(21 + i) }));
    }
    fakeDb.setRows(rows);

    const upcoming = await getUpcoming(now, 20, [2]);

    expect(upcoming).toHaveLength(5);
    expect(upcoming.every((f) => f.league_id === 2)).toBe(true);
  });

  it('an explicit empty leagueIds array matches nothing, not everything — same rule as getFixturesInRange', async () => {
    fakeDb.setRows([fixtureRow({ id: 1, league_id: 1, kickoff_utc: hoursFromNow(1) })]);
    const upcoming = await getUpcoming(now, 20, []);
    expect(upcoming).toEqual([]);
  });

  it('undefined leagueIds means every league, unchanged from today', async () => {
    fakeDb.setRows([
      fixtureRow({ id: 1, league_id: 1, kickoff_utc: hoursFromNow(1) }),
      fixtureRow({ id: 2, league_id: 2, kickoff_utc: hoursFromNow(2) }),
    ]);
    const upcoming = await getUpcoming(now, 20);
    expect(upcoming).toHaveLength(2);
  });
});
