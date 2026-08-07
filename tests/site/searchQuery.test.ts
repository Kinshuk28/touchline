import { describe, it, expect } from 'vitest';
import {
  MAX_QUERY_LENGTH, isSearchable, likeContains, matchRank, normalizeSearchQuery, sortByRelevance,
} from '@/lib/site/searchQuery';

describe('normalizeSearchQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSearchQuery('  real   madrid  ')).toBe('real madrid');
  });

  it('treats an absent query as empty rather than throwing', () => {
    expect(normalizeSearchQuery(undefined)).toBe('');
    expect(normalizeSearchQuery(null)).toBe('');
    expect(normalizeSearchQuery('')).toBe('');
  });

  it('caps a pathological query', () => {
    expect(normalizeSearchQuery('a'.repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('isSearchable', () => {
  it('rejects a query too short to mean anything', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable('a')).toBe(false);
  });

  it('accepts two characters and up', () => {
    expect(isSearchable('ar')).toBe(true);
    expect(isSearchable('arsenal')).toBe(true);
  });
});

describe('likeContains', () => {
  it('wraps the query for a contains match', () => {
    expect(likeContains('arsenal')).toBe('%arsenal%');
  });

  it('escapes ilike wildcards so they match themselves', () => {
    // Without this, "50%" matches "50" followed by anything at all.
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('a_b')).toBe('%a\\_b%');
  });

  it('escapes backslashes before the wildcards it adds', () => {
    expect(likeContains('a\\b')).toBe('%a\\\\b%');
  });
});

describe('matchRank / sortByRelevance', () => {
  it('ranks exact, then prefix, then word-boundary, then anywhere', () => {
    expect(matchRank('Arsenal', 'arsenal')).toBe(0);
    expect(matchRank('Arsenal FC', 'arsenal')).toBe(1);
    expect(matchRank('Manchester United', 'united')).toBe(2);
    expect(matchRank('Manchester', 'ester')).toBe(3);
  });

  it('surfaces the shortest, closest name first', () => {
    const names = ['Manchester City FC', 'Man City', 'Manchester United FC', 'Man United'];
    expect(sortByRelevance(names, 'man', (n) => n)).toEqual([
      'Man City', 'Man United', 'Manchester City FC', 'Manchester United FC',
    ]);
  });

  it('breaks a rank tie on length, then alphabetically — a total order, so results never shuffle', () => {
    // None of these match "zzz", so all rank equally: length decides first
    // (Elche and Betis are 5, Alaves 6), then the alphabet.
    expect(sortByRelevance(['Elche', 'Alaves', 'Betis'], 'zzz', (n) => n))
      .toEqual(['Betis', 'Elche', 'Alaves']);
  });

  it('treats a query with regex metacharacters as text, not a pattern', () => {
    // `matchRank` builds a word-boundary regex; an unescaped "(" would throw.
    expect(() => matchRank('Some Club (Reserves)', '(res')).not.toThrow();
  });

  it('does not mutate the input', () => {
    const names = ['B', 'A'];
    sortByRelevance(names, 'a', (n) => n);
    expect(names).toEqual(['B', 'A']);
  });
});
