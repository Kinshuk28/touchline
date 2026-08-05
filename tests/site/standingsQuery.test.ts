import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildStandingSelect, getStandings } from '@/lib/site/queries/standings';

// Same hand-rolled fake PostgREST client as tests/site/queries.test.ts —
// kept local to this file rather than shared, matching that file's own
// reasoning: this is the only test here that needs a database round trip.
type FakeRow = Record<string, unknown>;

const fakeDb = vi.hoisted(() => {
  let rows: FakeRow[] = [];
  let forcedError: { message: string } | null = null;

  function makeQuery(source: () => FakeRow[]) {
    const filters: Array<(r: FakeRow) => boolean> = [];
    let orderBy: { col: string; ascending: boolean } | null = null;

    const api = {
      select(_cols: string) { return api; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return api; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending ?? true };
        return api;
      },
      then<T, U>(
        onFulfilled?: ((v: { data: FakeRow[] | null; error: { message: string } | null }) => T | PromiseLike<T>) | null,
        onRejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ) {
        if (forcedError) return Promise.resolve({ data: null, error: forcedError }).then(onFulfilled, onRejected);
        let result = source().filter((r) => filters.every((f) => f(r)));
        if (orderBy) {
          const { col, ascending } = orderBy;
          result = [...result].sort((a, b) => {
            const cmp = Number(a[col]) - Number(b[col]);
            return ascending ? cmp : -cmp;
          });
        }
        return Promise.resolve({ data: result, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return {
    setRows(next: FakeRow[]) { rows = next; },
    setError(err: { message: string } | null) { forcedError = err; },
    client: { from: (_table: string) => makeQuery(() => rows) },
  };
});

vi.mock('@/lib/site/supabase', () => ({ readClient: () => fakeDb.client }));

function standingRow(overrides: Partial<FakeRow> & { league_id: number; team_id: number; season: number; position: number }): FakeRow {
  return {
    played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0,
    goal_difference: 0, points: 0, form: null, updated_at: '2026-05-01T00:00:00Z', team: null,
    ...overrides,
  };
}

describe('buildStandingSelect', () => {
  it('joins the team and includes club_colors and crest_url, per the spec', () => {
    const sel = buildStandingSelect();
    expect(sel).toContain('team:team_id');
    expect(sel).toContain('club_colors');
    expect(sel).toContain('crest_url');
  });

  it('selects every stats column plus form', () => {
    const sel = buildStandingSelect();
    for (const col of ['position', 'played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'goal_difference', 'points', 'form']) {
      expect(sel).toContain(col);
    }
  });
});

describe('getStandings', () => {
  beforeEach(() => fakeDb.setRows([]));

  it('scopes to exactly one league and one season', async () => {
    fakeDb.setRows([
      standingRow({ league_id: 1, team_id: 1, season: 2025, position: 1 }),
      standingRow({ league_id: 1, team_id: 2, season: 2026, position: 1 }),
      standingRow({ league_id: 2, team_id: 3, season: 2025, position: 1 }),
    ]);

    const result = await getStandings(1, 2025);

    expect(result).toHaveLength(1);
    expect(result[0]?.team_id).toBe(1);
  });

  it('orders by position ascending', async () => {
    fakeDb.setRows([
      standingRow({ league_id: 1, team_id: 3, season: 2025, position: 3 }),
      standingRow({ league_id: 1, team_id: 1, season: 2025, position: 1 }),
      standingRow({ league_id: 1, team_id: 2, season: 2025, position: 2 }),
    ]);

    const result = await getStandings(1, 2025);

    expect(result.map((r) => r.team_id)).toEqual([1, 2, 3]);
  });

  it('returns an empty array when nothing matches, not an error', async () => {
    const result = await getStandings(99, 2025);
    expect(result).toEqual([]);
  });

  it('throws with the function name and message when the query errors', async () => {
    fakeDb.setError({ message: 'boom' });
    await expect(getStandings(1, 2025)).rejects.toThrow(/getStandings: boom/);
    fakeDb.setError(null);
  });
});
