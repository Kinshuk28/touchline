import { describe, it, expect } from 'vitest';
import { slugify, slugWithFdId } from '@/lib/db/slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Manchester United FC')).toBe('manchester-united-fc');
  });
  it('strips diacritics so accented names get clean URLs', () => {
    expect(slugify('Atlético Madrid')).toBe('atletico-madrid');
    expect(slugify('Borussia Mönchengladbach')).toBe('borussia-monchengladbach');
  });
  it('removes punctuation', () => {
    expect(slugify('Brighton & Hove Albion')).toBe('brighton-hove-albion');
  });
  it('collapses repeated separators and trims them', () => {
    expect(slugify('  A --  B  ')).toBe('a-b');
  });
});

describe('slugWithFdId', () => {
  it('suffixes the slugified name with the numeric id', () => {
    expect(slugWithFdId('Manchester United FC', 66)).toBe('manchester-united-fc-66');
  });

  it('still strips diacritics and punctuation before appending the id', () => {
    expect(slugWithFdId('Atlético Madrid', 78)).toBe('atletico-madrid-78');
  });

  it('disambiguates two clubs that would otherwise slugify identically — the exact collision that used to abort the whole upsertTeams batch', () => {
    // Two differently-run football clubs that happen to share a display
    // name are not far-fetched (reserve sides, historical renames,
    // lower-division namesakes) — the point of the id suffix is that this
    // must never produce the same slug twice.
    const a = slugWithFdId('Real Union', 101);
    const b = slugWithFdId('Real Union', 202);
    expect(a).not.toBe(b);
    expect(a).toBe('real-union-101');
    expect(b).toBe('real-union-202');
  });
});
