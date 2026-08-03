import { describe, it, expect } from 'vitest';
import { slugify } from '@/lib/db/slug';

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
