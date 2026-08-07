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
  message: string | null;
  requests_used: number;
  started_at: string;
  finished_at: string | null;
}

/**
 * The most recent run of every job, newest first.
 *
 * One query for the last `limit` runs, reduced to one row per job in JS,
 * rather than a per-job query or a `distinct on` (which PostgREST cannot
 * express). 200 rows covers well over a day of the busiest schedule
 * (ingest-news every 15 minutes is 96/day), so a job that ran at all
 * recently is in here; one that hasn't is absent, and absence is exactly
 * what the page needs to report.
 */
export async function getLatestRunPerJob(limit = 200): Promise<IngestRun[]> {
  const { data, error } = await readClient()
    .from('ingest_run')
    .select('id,job,status,message,requests_used,started_at,finished_at')
    .order('started_at', { ascending: false })
    .limit(limit);
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
