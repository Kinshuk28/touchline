import { z } from 'zod';

const schema = z.object({
  FOOTBALL_DATA_KEY: z.string().min(10, 'FOOTBALL_DATA_KEY looks too short'),
  SUPABASE_URL: z
    .string()
    .url()
    .refine((u) => !u.endsWith('/'), 'SUPABASE_URL must not have a trailing slash')
    .refine(
      (u) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u),
      'SUPABASE_URL must be the project API URL (https://<ref>.supabase.co), not the dashboard URL',
    ),
  // Required: the site reads with this key (SELECT-only, enforced by grants
  // and row-level security), while ingestion writes with the service-role
  // key below. Phase B's read-only data layer depends on this being present.
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

// `scripts/ingest/*`, `scripts/backfill.ts`, `scripts/repair/*` and
// `scripts/verify-schema.ts` (via `lib/db/client.ts#serviceClient`) write
// with the service-role key and read football-data.org with its own key —
// they must never require, and structurally cannot obtain,
// `SUPABASE_ANON_KEY`. That key belongs exclusively to `lib/site/` (via
// `loadSiteEnv` below). `.pick()` on the single `schema` above keeps one
// source of truth for what a valid Supabase URL and service-role key look
// like, rather than duplicating those refinements here.
//
// There used to be a monolithic `loadEnv()` that validated all four
// variables — so an ingestion workflow that correctly withheld
// `SUPABASE_ANON_KEY` (it never reads with it) failed before doing any
// work: `Invalid environment: SUPABASE_ANON_KEY: Invalid input: expected
// string, received undefined`. Once every caller (all of `scripts/ingest/*`,
// `scripts/backfill.ts` and `lib/db/client.ts#serviceClient`, which
// `scripts/repair/*` and `scripts/verify-schema.ts` go through) moved to
// `loadIngestEnv`, `loadEnv` had no callers left and was deleted outright —
// a dead export naming the wrong four variables is exactly what the next
// person reaches for by habit.
const ingestSchema = schema.pick({
  FOOTBALL_DATA_KEY: true,
  SUPABASE_URL: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});

export type IngestEnv = z.infer<typeof ingestSchema>;

export function loadIngestEnv(source: Record<string, string | undefined> = process.env): IngestEnv {
  const parsed = ingestSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

// The public site (`lib/site/`) only ever reads the database, with the
// anon key — SELECT-only, enforced by grants and row-level security. It
// must never require, and structurally cannot obtain, `SUPABASE_SERVICE_ROLE_KEY`
// or `FOOTBALL_DATA_KEY`: those belong exclusively to `scripts/ingest/*`
// (via `loadIngestEnv`/`lib/db/client.ts#serviceClient`). `.pick()` on the single
// `schema` above keeps one source of truth for what a valid Supabase URL
// and anon key look like, rather than duplicating those refinements here.
//
// Before this split, `lib/site/supabase.ts` called the monolithic
// `loadEnv()` directly, which validated all four variables — so a deploy
// target (or CI run) that supplied only the two read credentials the site
// actually needs would fail
// to render a single page. Worse, it meant the service-role key had to be
// present just to serve a page at all, one `process.env` dump or error-
// boundary leak away from exposure. `next build` executes these server
// components' data-fetching code at build time for any statically
// prerenderable route, so this was never a theoretical, request-time-only
// concern.
const siteSchema = schema.pick({ SUPABASE_URL: true, SUPABASE_ANON_KEY: true });

export type SiteEnv = z.infer<typeof siteSchema>;

export function loadSiteEnv(source: Record<string, string | undefined> = process.env): SiteEnv {
  const parsed = siteSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
