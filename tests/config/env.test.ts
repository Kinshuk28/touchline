import { describe, it, expect } from 'vitest';
import { loadEnv, loadSiteEnv } from '@/lib/config/env';

const valid = {
  FOOTBALL_DATA_KEY: 'a'.repeat(32),
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'b'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 'c'.repeat(40),
};

describe('loadEnv', () => {
  it('returns a typed env object when everything is present', () => {
    expect(loadEnv(valid).SUPABASE_URL).toBe(valid.SUPABASE_URL);
  });

  it('throws naming the missing variable', () => {
    const { FOOTBALL_DATA_KEY, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/FOOTBALL_DATA_KEY/);
  });

  it('rejects the Supabase dashboard URL, which is the common mistake', () => {
    expect(() =>
      loadEnv({ ...valid, SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst' }),
    ).toThrow(/API URL/);
  });

  it('rejects a trailing slash so request paths never double up', () => {
    expect(() =>
      loadEnv({ ...valid, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/' }),
    ).toThrow(/trailing slash/);
  });

  it('requires SUPABASE_ANON_KEY — the site reads with it, so a missing key must fail loudly rather than at request time', () => {
    const { SUPABASE_ANON_KEY, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/SUPABASE_ANON_KEY/);
  });
});

// Critical 1 regression guard: the public site must be able to render with
// only the two read credentials present — never the service-role key, never
// the football-data ingest key. Before this split, `lib/site/supabase.ts`
// called the monolithic `loadEnv()`, which required all four variables, so
// any deploy target (Netlify, CI) that withheld the service-role key on
// purpose — the correct thing to do, since the site never needs it —
// couldn't render a single page. `next build` runs this code at build time
// for any statically prerenderable route, so the failure showed up before a
// server ever started.
describe('loadSiteEnv', () => {
  const siteOnly = { SUPABASE_URL: valid.SUPABASE_URL, SUPABASE_ANON_KEY: valid.SUPABASE_ANON_KEY };

  it('succeeds with only SUPABASE_URL and SUPABASE_ANON_KEY present — no FOOTBALL_DATA_KEY, no service-role key', () => {
    expect(loadSiteEnv(siteOnly)).toEqual(siteOnly);
  });

  it('the returned object has no service-role key field even when one is present in the source', () => {
    const result = loadSiteEnv({ ...valid }) as Record<string, unknown>;
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(result.FOOTBALL_DATA_KEY).toBeUndefined();
  });

  it('still throws naming the missing variable when SUPABASE_URL is absent', () => {
    const { SUPABASE_URL, ...rest } = siteOnly;
    expect(() => loadSiteEnv(rest)).toThrow(/SUPABASE_URL/);
  });

  it('still applies the same SUPABASE_URL validation as loadEnv (rejects the dashboard URL)', () => {
    expect(() =>
      loadSiteEnv({ ...siteOnly, SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst' }),
    ).toThrow(/API URL/);
  });
});
