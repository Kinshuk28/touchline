import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '@/lib/config/env';

let cached: SupabaseClient | null = null;

/**
 * Read-only client for the public site. The anon key is SELECT-only, enforced
 * by grants AND row-level security, so this cannot write even if asked to.
 * Never import the service-role client into anything the site renders.
 */
export function readClient(): SupabaseClient {
  if (cached) return cached;
  const env = loadEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
