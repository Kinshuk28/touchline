import { describe, it, expect } from 'vitest';
import { monogram, monogramColor } from '@/lib/site/monogram';

describe('monogram', () => {
  it('takes initials from a multi-word club name', () => {
    expect(monogram('Manchester United FC')).toBe('MU');
  });
  it('drops common club-type suffixes so they never become initials', () => {
    expect(monogram('Arsenal FC')).toBe('AR');
    expect(monogram('FC Bayern München')).toBe('BM');
  });
  it('falls back to the first two letters of a single-word name', () => {
    expect(monogram('Juventus')).toBe('JU');
  });
  it('strips diacritics so the glyph is always renderable', () => {
    expect(monogram('Atlético Madrid')).toBe('AM');
  });
  it('never returns more than two characters', () => {
    expect(monogram('Borussia Verein für Leibesübungen Mönchengladbach').length).toBeLessThanOrEqual(2);
  });
  it('returns a stable placeholder for an empty name rather than throwing', () => {
    expect(monogram('')).toBe('??');
  });
});

describe('monogramColor', () => {
  it('is deterministic for the same club', () => {
    expect(monogramColor('Arsenal FC')).toBe(monogramColor('Arsenal FC'));
  });
  it('differs between clubs', () => {
    expect(monogramColor('Arsenal FC')).not.toBe(monogramColor('Chelsea FC'));
  });
  it('returns a hex colour', () => {
    expect(monogramColor('Arsenal FC')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
