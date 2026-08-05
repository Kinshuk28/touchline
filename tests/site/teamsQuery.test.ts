import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTeams } from '@/lib/site/queries/teams';

// Same hand-rolled fake PostgREST client as tests/site/standingsQuery.test.ts
// and tests/site/queries.test.ts — kept local rather than shared, matching
// those files' own reasoning.
type FakeRow = Record<string, unknown>;

const fakeDb = vi.hoisted(() => {
  let rows: FakeRow[] = [];
  let forcedError: { message: string } | null = null;
  let lastSelect: string | null = null;

  function makeQuery(source: () => FakeRow[]) {
    let orderBy: { col: string; ascending: boolean } | null = null;

    const api = {
      select(cols: string) { lastSelect = cols; return api; },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, ascending: opts?.ascending ?? true };
        return api;
      },
      then<T, U>(
        onFulfilled?: ((v: { data: FakeRow[] | null; error: { message: string } | null }) => T | PromiseLike<T>) | null,
        onRejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ) {
        if (forcedError) return Promise.resolve({ data: null, error: forcedError }).then(onFulfilled, onRejected);
        let result = source();
        if (orderBy) {
          const { col, ascending } = orderBy;
          result = [...result].sort((a, b) => {
            const cmp = String(a[col]).localeCompare(String(b[col]));
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
    getLastSelect: () => lastSelect,
    client: { from: (_table: string) => makeQuery(() => rows) },
  };
});

vi.mock('@/lib/site/supabase', () => ({ readClient: () => fakeDb.client }));

function clubRow(overrides: Partial<FakeRow> & { id: number; name: string }): FakeRow {
  return {
    fd_id: overrides.id, slug: `club-${overrides.id}`, short_name: null, tla: null,
    crest_url: null, venue: null, founded: null, club_colors: null, league_id: 1,
    ...overrides,
  };
}

describe('getTeams', () => {
  beforeEach(() => {
    fakeDb.setRows([]);
    fakeDb.setError(null);
  });

  it('selects venue, founded, club_colors and league_id alongside identity fields', async () => {
    fakeDb.setRows([clubRow({ id: 1, name: 'Arsenal FC' })]);
    await getTeams();
    const sel = fakeDb.getLastSelect();
    expect(sel).toContain('venue');
    expect(sel).toContain('founded');
    expect(sel).toContain('club_colors');
    expect(sel).toContain('league_id');
    expect(sel).toContain('crest_url');
  });

  it('orders alphabetically by name', async () => {
    fakeDb.setRows([
      clubRow({ id: 1, name: 'Wolverhampton Wanderers FC' }),
      clubRow({ id: 2, name: 'Arsenal FC' }),
      clubRow({ id: 3, name: 'Manchester City FC' }),
    ]);
    const result = await getTeams();
    expect(result.map((r) => r.name)).toEqual(['Arsenal FC', 'Manchester City FC', 'Wolverhampton Wanderers FC']);
  });

  it('returns an empty array when nothing matches, not an error', async () => {
    const result = await getTeams();
    expect(result).toEqual([]);
  });

  it('throws with the function name and message when the query errors', async () => {
    fakeDb.setError({ message: 'boom' });
    await expect(getTeams()).rejects.toThrow(/getTeams: boom/);
  });
});
