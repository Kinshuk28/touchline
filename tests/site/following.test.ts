import { describe, it, expect } from 'vitest';
import {
  FOLLOWING_COOKIE_NAME,
  parseFollowingCookie,
  serializeFollowingCookie,
  toggleFollowingCode,
} from '@/lib/site/following';

describe('FOLLOWING_COOKIE_NAME', () => {
  it('is the exact name the spec requires', () => {
    expect(FOLLOWING_COOKIE_NAME).toBe('touchline-following');
  });
});

describe('parseFollowingCookie', () => {
  it('parses a comma-separated list of codes', () => {
    expect(parseFollowingCookie('PL,PD')).toEqual(['PL', 'PD']);
  });

  it('upper-cases and trims each code', () => {
    expect(parseFollowingCookie('pl, pd ,  sa')).toEqual(['PL', 'PD', 'SA']);
  });

  it('returns an empty list for null, undefined and empty string — no cookie set', () => {
    expect(parseFollowingCookie(null)).toEqual([]);
    expect(parseFollowingCookie(undefined)).toEqual([]);
    expect(parseFollowingCookie('')).toEqual([]);
  });

  it('drops entries that are not a plausible league code, without dropping the rest', () => {
    expect(parseFollowingCookie('PL,,<script>,SA')).toEqual(['PL', 'SA']);
  });

  // The core requirement: a malformed value (here, a `%` that is not a
  // valid percent-escape, which makes decodeURIComponent throw) must yield
  // an empty list rather than throwing out of this function.
  it('yields an empty list for a malformed value instead of throwing', () => {
    expect(() => parseFollowingCookie('%')).not.toThrow();
    expect(parseFollowingCookie('%')).toEqual([]);
    expect(parseFollowingCookie('%E0%A4%A')).toEqual([]);
  });

  it('round-trips through serializeFollowingCookie', () => {
    const value = serializeFollowingCookie(['PL', 'BL1']);
    expect(parseFollowingCookie(value)).toEqual(['PL', 'BL1']);
  });
});

describe('serializeFollowingCookie', () => {
  it('joins codes with commas', () => {
    expect(decodeURIComponent(serializeFollowingCookie(['PL', 'PD']))).toBe('PL,PD');
  });

  it('dedupes and upper-cases', () => {
    expect(decodeURIComponent(serializeFollowingCookie(['pl', 'PL', 'pd']))).toBe('PL,PD');
  });

  it('produces an empty string for no codes', () => {
    expect(serializeFollowingCookie([])).toBe('');
  });

  it('drops anything that would not round-trip back through parseFollowingCookie', () => {
    expect(decodeURIComponent(serializeFollowingCookie(['PL', '<script>']))).toBe('PL');
  });
});

describe('toggleFollowingCode', () => {
  it('adds a code that is not yet present', () => {
    expect(toggleFollowingCode(['PL'], 'PD')).toEqual(['PL', 'PD']);
  });

  it('removes a code that is already present', () => {
    expect(toggleFollowingCode(['PL', 'PD'], 'PL')).toEqual(['PD']);
  });

  it('normalises case before comparing', () => {
    expect(toggleFollowingCode(['PL'], 'pl')).toEqual([]);
  });

  it('following nothing is the default: toggling once from empty adds exactly one', () => {
    expect(toggleFollowingCode([], 'SA')).toEqual(['SA']);
  });
});
