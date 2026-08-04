import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSiteEnv } from '@/lib/config/env';

let cached: SupabaseClient | null = null;

/**
 * Read-only client for the public site. The anon key is SELECT-only, enforced
 * by grants AND row-level security, so this cannot write even if asked to.
 * Never import the service-role client into anything the site renders.
 *
 * Deliberately `loadSiteEnv()`, not `loadEnv()`: the site must never require
 * — and, since `loadSiteEnv`'s schema simply has no field for it, cannot
 * even in principle obtain — `SUPABASE_SERVICE_ROLE_KEY` or
 * `FOOTBALL_DATA_KEY` just to render a page. Those stay exclusive to
 * `scripts/ingest/*` via `lib/db/client.ts#serviceClient`.
 */
export function readClient(): SupabaseClient {
  if (cached) return cached;
  const env = loadSiteEnv();
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
