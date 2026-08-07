import { readClient } from '@/lib/site/supabase';

/**
 * The ingest side of the house, read-only, for `/status`.
 *
 * Everything the site shows is written by scheduled jobs
 * (.github/workflows/ingest-*.yml). When a job stops running the pages do
 * not break — they quietly go stale, which is worse. These queries are what
 * lets a page say so out loud.
 */

export interface IngestRun {
  id: number;
  job: string;
  status: string;
  requests_used: number;
  started_at: string;
  finished_at: string | null;
}

/**
 * The view this reads, not the table.
 *
 * `ingest_run` is deliberately unreadable with the public key: migration
 * 0003 revoked anon SELECT on it because `ingest_run.message` carries a
 * raw slice of the upstream provider's error body, and that column becomes
 * world-readable the moment the anon key ships to a browser. That decision
 * stands — this page is not worth reopening it.
 *
 * 0003 suggested `/status` read the table server-side with the service-role
 * key instead. It cannot: this project's standing rule is that the
 * service-role client never enters anything the site renders, and putting a
 * full-power key in the render path to draw a status table is a far worse
 * trade than not drawing it.
 *
 * So migration 0005 proposes a view over the same rows with `message`
 * omitted — job, status, timings and request count, none of which can carry
 * an upstream response body — and grants SELECT on that. Everything else
 * about 0003's posture is untouched.
 */
const RUNS_VIEW = 'ingest_run_public';

/**
 * The most recent run of every job, newest first, or `null` when the view
 * is not readable.
 *
 * `null` rather than a throw, and rather than an empty array, because the
 * three cases are genuinely different and the page says something different
 * for each: no runs recorded (empty array), the view is missing or
 * ungranted (null — migration 0005 has not been applied), or a real query
 * failure (throws, like every other query here).
 *
 * One query for the last `limit` runs, reduced to one row per job in JS,
 * rather than a per-job query or a `distinct on` (which PostgREST cannot
 * express). 200 rows covers well over a day of the busiest schedule
 * (ingest-news every 15 minutes is 96/day), so a job that ran at all
 * recently is in here; one that hasn't is absent, and absence is exactly
 * what the page needs to report.
 */
/**
 * "The view isn't there, or isn't readable" — i.e. migration 0005 has not
 * been applied — as opposed to a real query failure.
 *
 * Two error *layers* produce this, which is the part that caught me out.
 * Postgres answers an unknown relation with 42P01 and a forbidden one with
 * 42501, but PostgREST resolves relations against its own schema cache
 * first and answers PGRST205 ("Could not find the table 'public.x' in the
 * schema cache") before Postgres is ever asked. The local mock modelled the
 * Postgres layer, so the Postgres codes were handled and the PostgREST one
 * went straight to `throw` — and took the build down (CI, 2026-08-07).
 *
 * Matched on codes first and message text only as a backstop, since the
 * message wording is the least stable part of either contract.
 */
function isMissingOrForbidden(error: { code?: string; message: string }): boolean {
  const code = error.code ?? '';
  if (['42P01', '42501', 'PGRST205', 'PGRST106', 'PGRST301'].includes(code)) return true;
  return /schema cache|does not exist|permission denied/i.test(error.message);
}

export async function getLatestRunPerJob(limit = 200): Promise<IngestRun[] | null> {
  const { data, error } = await readClient()
    .from(RUNS_VIEW)
    .select('id,job,status,requests_used,started_at,finished_at')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error && isMissingOrForbidden(error)) return null;
  if (error) throw new Error(`getLatestRunPerJob: ${error.message}`);

  const latest = new Map<string, IngestRun>();
  for (const run of (data ?? []) as IngestRun[]) {
    if (!latest.has(run.job)) latest.set(run.job, run);
  }
  return [...latest.values()];
}

/**
 * The freshest row in a table — how old the data itself is, as opposed to
 * when a job last claimed to run. The two can disagree: a job that succeeds
 * while its provider returns nothing new leaves the data untouched, and
 * only this number shows that.
 *
 * The timestamp column is *not* the same in every table, which is why this
 * is a map rather than a hardcoded `updated_at`. `news_items` has no
 * `updated_at` at all — a news item is written once and never revised, so
 * the schema gives it `created_at` — and asking for the wrong column is a
 * hard PostgREST error, not an empty result (CI caught exactly that:
 * "column news_items.updated_at does not exist", which the local mock had
 * been quietly returning as `empty`).
 *
 * `null` when the table is empty, which is a real answer, not an error.
 */
export const FRESHNESS_COLUMN = {
  fixtures: 'updated_at',
  standings: 'updated_at',
  players: 'updated_at',
  news_items: 'created_at',
} as const;

export type FreshnessTable = keyof typeof FRESHNESS_COLUMN;

export async function getLatestUpdate(table: FreshnessTable): Promise<string | null> {
  const column = FRESHNESS_COLUMN[table];
  const { data, error } = await readClient()
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw new Error(`getLatestUpdate(${table}): ${error.message}`);
  return (data?.[0] as Record<string, string> | undefined)?.[column] ?? null;
}
