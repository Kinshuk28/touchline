import { describe, it, expect } from 'vitest';
import { loadEnv } from '@/lib/config/env';

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
});
