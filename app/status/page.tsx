import type { Metadata } from 'next';
import { FRESHNESS_COLUMN, getLatestRunPerJob, getLatestUpdate, type FreshnessTable } from '@/lib/site/queries/status';
import { jobHealth, sortRunsByHealth, JOB_CADENCE_MINUTES, type JobHealth } from '@/lib/site/ingestHealth';
import { relativeTime } from '@/lib/site/format';
import { BoardPanel } from '@/components/BoardPanel';

/*
 * /status — is the data actually arriving?
 *
 * Everything on this site is written by scheduled jobs. When one stops, no
 * page breaks: they quietly go stale, which is harder to notice and worse.
 * This route makes that visible — the last run of every job, whether it is
 * overdue against its own schedule, and how old the data in each table
 * actually is.
 *
 * Deliberately not cached beyond a minute: a status page showing a
 * five-minute-old view of whether things are broken is its own small joke.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Status — Touchline',
  description: 'Ingest job health and data freshness.',
};

const HEALTH_LABEL: Record<JobHealth, string> = {
  ok: 'OK',
  stale: 'Overdue',
  failed: 'Failed',
  running: 'Running',
};

// `--live` is the site's one alarm colour and it is reserved for exactly
// that: a failure. Overdue is muted-but-emphasised rather than a second
// shade of red, and text says which is which regardless of colour.
const HEALTH_CLASS: Record<JobHealth, string> = {
  ok: 'text-muted',
  stale: 'text-text font-semibold',
  failed: 'text-live font-semibold',
  running: 'text-muted',
};

const TABLES = Object.keys(FRESHNESS_COLUMN) as FreshnessTable[];

export default async function StatusPage() {
  const now = new Date();
  const [runs, ...freshness] = await Promise.all([
    getLatestRunPerJob(),
    ...TABLES.map((t) => getLatestUpdate(t)),
  ]);

  // `null` means the runs view is not readable — migration 0005 has not
  // been applied. That is a state to report, not a crash: the freshness
  // panel below reads public tables and works regardless.
  const ordered = runs === null ? [] : sortRunsByHealth(runs, now);
  const failing = ordered.filter((r) => jobHealth(r, now) === 'failed').length;
  const overdue = ordered.filter((r) => jobHealth(r, now) === 'stale').length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Status</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every page here is built from scheduled ingest jobs. This is what those jobs last did, and
          how old the stored data is — a job that stops running doesn&rsquo;t break a page, it just
          quietly ages it.
        </p>
      </div>

      {/* A one-line verdict, so the page answers its own question before
          anyone reads a table. */}
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
        {runs === null
          ? 'Job history isn\u2019t readable with the public key yet — see the panel below. Data freshness still is.'
          : runs.length === 0
            ? 'No ingest runs recorded yet.'
            : failing === 0 && overdue === 0
              ? `All ${runs.length} jobs reporting normally.`
              : [
                failing > 0 ? `${failing} failing` : null,
                overdue > 0 ? `${overdue} overdue` : null,
              ].filter(Boolean).join(', ') + ` of ${runs.length} jobs.`}
      </p>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <BoardPanel order={0} label="Ingest jobs" meta={runs === null ? undefined : `${runs.length}`}>
          {runs === null ? (
            // Said plainly rather than shown as an empty table. `ingest_run`
            // is deliberately private (migration 0003: its `message` column
            // carries raw upstream error bodies), and this page reads a
            // view that omits that column — which exists only once
            // migration 0005 is applied by hand.
            <p className="px-3 py-4 text-13 text-muted">
              Ingest job history is private to the pipeline. Applying migration
              <span className="font-mono"> 0005_ingest_run_public_view.sql </span>
              exposes job, status and timings — but never the error message, which can contain a raw
              upstream response — to this page.
            </p>
          ) : ordered.length === 0 ? (
            <p className="px-3 py-4 text-13 text-muted">No ingest runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-13">
                <caption className="sr-only">Most recent run of each ingest job</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-11 uppercase tracking-wide text-muted">
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">Job</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">State</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">Last run</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((run) => {
                    const health = jobHealth(run, now);
                    const cadence = JOB_CADENCE_MINUTES[run.job];
                    return (
                      <tr key={run.job} className="border-b border-border last:border-b-0 align-top">
                        <td className="px-3 py-2">
                          <span className="font-mono">{run.job}</span>
                          {cadence !== undefined && (
                            <span className="block text-11 text-muted">
                              every {cadence < 60 ? `${cadence} min` : `${cadence / 60} h`}
                            </span>
                          )}
                        </td>
                        {/* State only. The provider's own error message is
                            deliberately not exposed here — it is the column
                            migration 0003 locked down, and reading it would
                            put a raw upstream response body on a public
                            page. The GitHub Actions log is where a failure's
                            reason belongs. */}
                        <td className={`px-3 py-2 ${HEALTH_CLASS[health]}`}>{HEALTH_LABEL[health]}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-muted">
                          {relativeTime(run.started_at, now) ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                          {run.requests_used}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </BoardPanel>

        <BoardPanel order={1} label="Data freshness">
          <ul>
            {TABLES.map((table, i) => (
              <li key={table} className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <span className="font-mono text-13">
                  {table}
                  {/* Which column this row is reading. They differ —
                      news_items is written once and never revised, so it
                      has created_at and no updated_at — and naming it is
                      what stops "fresh" meaning two different things in
                      one panel. */}
                  <span className="ml-1.5 text-11 text-muted">{FRESHNESS_COLUMN[table]}</span>
                </span>
                {/* When the data itself last changed, which is not the same
                    as when a job last ran: a successful run against a
                    provider with nothing new leaves this untouched. */}
                <span className="font-mono text-13 text-muted">
                  {freshness[i] ? relativeTime(freshness[i], now) ?? 'just now' : 'empty'}
                </span>
              </li>
            ))}
          </ul>
        </BoardPanel>
      </div>
    </div>
  );
}
