import { describe, it, expect } from 'vitest';
import { decodeAccessToken, needsRefresh } from '@/lib/auth/jwt';

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify(payload))}.signature`;
}

const NOW = new Date('2026-08-07T12:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

describe('decodeAccessToken', () => {
  it('reads the claims a session needs', () => {
    const claims = decodeAccessToken(token({ sub: 'user-1', email: 'a@example.com', exp: 1800000000 }));
    expect(claims).toEqual({ sub: 'user-1', email: 'a@example.com', exp: 1800000000 });
  });

  it('keeps a non-ASCII email intact', () => {
    // Naive base64 decoding mangles anything outside Latin-1; the address a
    // manager typed is the address they should see back.
    const claims = decodeAccessToken(token({ sub: 'u', email: 'jörg@münchen.example', exp: 1 }));
    expect(claims!.email).toBe('jörg@münchen.example');
  });

  it('returns null rather than a partial answer for a malformed token', () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d', `x.${base64url('not json')}.y`]) {
      expect(decodeAccessToken(bad)).toBeNull();
    }
  });

  it('returns null for a payload that is valid JSON but not an object', () => {
    expect(decodeAccessToken(`h.${base64url('"a string"')}.s`)).toBeNull();
    expect(decodeAccessToken(`h.${base64url('null')}.s`)).toBeNull();
  });

  it('reports a missing or wrongly-typed claim as null rather than coercing it', () => {
    const claims = decodeAccessToken(token({ sub: 42, exp: '1800000000' }));
    expect(claims).toEqual({ sub: null, email: null, exp: null });
  });
});

describe('needsRefresh', () => {
  it('leaves a token with plenty of life alone', () => {
    expect(needsRefresh(token({ exp: NOW_SECONDS + 3600 }), NOW)).toBe(false);
  });

  it('refreshes before expiry, not at it', () => {
    // A token that passes this check and then expires mid-request produces a
    // signed-in page that cannot load its own data.
    expect(needsRefresh(token({ exp: NOW_SECONDS + 30 }), NOW)).toBe(true);
    expect(needsRefresh(token({ exp: NOW_SECONDS + 90 }), NOW)).toBe(false);
  });

  it('refreshes an already-expired token', () => {
    expect(needsRefresh(token({ exp: NOW_SECONDS - 1 }), NOW)).toBe(true);
  });

  it('treats an undecodable or expiry-less token as needing refresh', () => {
    // Erring toward a wasted refresh, never toward a request made with a
    // token that turns out to be dead.
    expect(needsRefresh('garbage', NOW)).toBe(true);
    expect(needsRefresh(token({ sub: 'u' }), NOW)).toBe(true);
  });

  it('honours an explicit skew', () => {
    expect(needsRefresh(token({ exp: NOW_SECONDS + 120 }), NOW, 300)).toBe(true);
    expect(needsRefresh(token({ exp: NOW_SECONDS + 120 }), NOW, 10)).toBe(false);
  });
});
