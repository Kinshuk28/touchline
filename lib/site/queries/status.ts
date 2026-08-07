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
 * The freshest `updated_at` in a table — how old the data itself is, as
 * opposed to when a job last claimed to run. The two can disagree: a job
 * that succeeds while its provider returns nothing new leaves the data
 * untouched, and only this number shows that.
 *
 * `null` when the table is empty, which is a real answer, not an error.
 */
export async function getLatestUpdate(table: 'fixtures' | 'standings' | 'news_items' | 'players'): Promise<string | null> {
  const { data, error } = await readClient()
    .from(table)
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`getLatestUpdate(${table}): ${error.message}`);
  return (data?.[0] as { updated_at: string } | undefined)?.updated_at ?? null;
}
