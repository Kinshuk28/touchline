import { describe, it, expect } from 'vitest';
import { dedupeByKey } from '@/lib/db/dedupe';

describe('dedupeByKey', () => {
  it('returns an empty array for empty input', () => {
    expect(dedupeByKey([], (r: { id: number }) => r.id)).toEqual([]);
  });

  it('leaves rows with no duplicate keys unchanged', () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }];
    expect(dedupeByKey(rows, (r) => r.id)).toEqual(rows);
  });

  it('collapses duplicate keys, keeping the last occurrence', () => {
    const rows = [
      { id: 1, name: 'first' },
      { id: 2, name: 'untouched' },
      { id: 1, name: 'second' },
    ];
    const result = dedupeByKey(rows, (r) => r.id);
    expect(result).toHaveLength(2);
    const byId = new Map(result.map((r) => [r.id, r]));
    expect(byId.get(1)!.name).toBe('second'); // last-wins, not first
    expect(byId.get(2)!.name).toBe('untouched');
  });

  it('dedupes on a composite key built from multiple fields', () => {
    const rows = [
      { league_id: 1, season: 2025, team_id: 10, points: 30 },
      { league_id: 1, season: 2026, team_id: 10, points: 5 }, // different season, not a dup
      { league_id: 1, season: 2025, team_id: 10, points: 45 }, // same composite key as row 1
    ];
    const result = dedupeByKey(rows, (r) => `${r.league_id}|${r.season}|${r.team_id}`);
    expect(result).toHaveLength(2);
    const key = (r: (typeof rows)[number]) => `${r.league_id}|${r.season}|${r.team_id}`;
    const byKey = new Map(result.map((r) => [key(r), r]));
    expect(byKey.get('1|2025|10')!.points).toBe(45); // last-wins for the composite key
    expect(byKey.get('1|2026|10')!.points).toBe(5);
  });
});
