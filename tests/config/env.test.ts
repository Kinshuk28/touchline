import { describe, it, expect } from 'vitest';
import { loadIngestEnv, loadSiteEnv } from '@/lib/config/env';

const valid = {
  FOOTBALL_DATA_KEY: 'a'.repeat(32),
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_ANON_KEY: 'b'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 'c'.repeat(40),
};

// Critical 1 regression guard, ingestion side: `scripts/ingest/*`,
// `scripts/backfill.ts` and `lib/db/client.ts#serviceClient` (which
// `scripts/repair/*` and `scripts/verify-schema.ts` go through) must be able
// to run with only the three write/fetch credentials present — never the
// anon key, which they never read with. Before this fix, all of them called
// the monolithic `loadEnv()`, which required all four variables, so the
// ingestion workflows — which correctly withhold `SUPABASE_ANON_KEY` —
// failed before doing any work: `Invalid environment: SUPABASE_ANON_KEY:
// Invalid input: expected string, received undefined`.
describe('loadIngestEnv', () => {
  const ingestOnly = {
    FOOTBALL_DATA_KEY: valid.FOOTBALL_DATA_KEY,
    SUPABASE_URL: valid.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: valid.SUPABASE_SERVICE_ROLE_KEY,
  };

  it('succeeds with only FOOTBALL_DATA_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY present — no SUPABASE_ANON_KEY', () => {
    expect(loadIngestEnv(ingestOnly)).toEqual(ingestOnly);
  });

  it('the returned object has no anon key field even when one is present in the source', () => {
    const result = loadIngestEnv({ ...valid }) as Record<string, unknown>;
    expect(result.SUPABASE_ANON_KEY).toBeUndefined();
  });

  it('throws naming the missing variable when FOOTBALL_DATA_KEY is absent', () => {
    const { FOOTBALL_DATA_KEY, ...rest } = ingestOnly;
    expect(() => loadIngestEnv(rest)).toThrow(/FOOTBALL_DATA_KEY/);
  });

  it('throws naming the missing variable when SUPABASE_SERVICE_ROLE_KEY is absent', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = ingestOnly;
    expect(() => loadIngestEnv(rest)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('still applies the same SUPABASE_URL validation as the full schema (rejects the dashboard URL)', () => {
    expect(() =>
      loadIngestEnv({ ...ingestOnly, SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst' }),
    ).toThrow(/API URL/);
  });

  it('rejects a trailing slash so request paths never double up', () => {
    expect(() =>
      loadIngestEnv({ ...ingestOnly, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/' }),
    ).toThrow(/trailing slash/);
  });
});

// Critical 1 regression guard, site side: the public site must be able to
// render with only the two read credentials present — never the
// service-role key, never the football-data ingest key. Before this split,
// `lib/site/supabase.ts` called the monolithic `loadEnv()`, which required
// all four variables, so any deploy target (Netlify, CI) that withheld the
// service-role key on purpose — the correct thing to do, since the site
// never needs it — couldn't render a single page. `next build` runs this
// code at build time for any statically prerenderable route, so the failure
// showed up before a server ever started.
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

  it('still applies the same SUPABASE_URL validation as loadIngestEnv (rejects the dashboard URL)', () => {
    expect(() =>
      loadSiteEnv({ ...siteOnly, SUPABASE_URL: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst' }),
    ).toThrow(/API URL/);
  });
});
