import type { IngestRun } from '@/lib/site/queries/status';

/**
 * How a job's last run should read on /status.
 *
 * Three states, and the third is the one that matters: a job whose last run
 * *succeeded* can still be a problem if that run was hours ago and the job
 * is supposed to run every fifteen minutes. A status page that only ever
 * echoes the last run's exit code would call that healthy right up until
 * someone noticed the scores were a day old.
 */
export type JobHealth = 'ok' | 'stale' | 'failed' | 'running';

/**
 * How long after its expected cadence a job counts as stale. Generous —
 * three times the schedule — because GitHub's scheduled runners routinely
 * drop or delay a run, and a page that cries wolf at the first missed tick
 * gets ignored.
 */
export const STALE_MULTIPLIER = 3;

/**
 * Each job's schedule in minutes, from .github/workflows/ingest-*.yml. A
 * job not listed here has no expectation attached and can only ever be
 * reported on its exit status — never guessed at.
 */
export const JOB_CADENCE_MINUTES: Readonly<Record<string, number>> = {
  'ingest-live': 15,
  'ingest-news': 15,
  'ingest-core': 60,
  'ingest-players': 720,
  'ingest-squads': 1440,
};

export function jobHealth(run: IngestRun, now: Date): JobHealth {
  if (run.status !== 'ok' && run.status !== 'success') {
    // A run with no `finished_at` and a non-terminal status is still going,
    // which is not a failure.
    return run.finished_at === null ? 'running' : 'failed';
  }
  const cadence = JOB_CADENCE_MINUTES[run.job];
  if (cadence === undefined) return 'ok';
  const ageMinutes = (now.getTime() - new Date(run.started_at).getTime()) / 60_000;
  return ageMinutes > cadence * STALE_MULTIPLIER ? 'stale' : 'ok';
}

/** Failures first, then stale, then running, then healthy — a status page is read top-down for what is wrong. */
const HEALTH_ORDER: Readonly<Record<JobHealth, number>> = { failed: 0, stale: 1, running: 2, ok: 3 };

export function sortRunsByHealth(runs: readonly IngestRun[], now: Date): IngestRun[] {
  return runs
    .slice()
    .sort((a, b) => (
      HEALTH_ORDER[jobHealth(a, now)] - HEALTH_ORDER[jobHealth(b, now)]
      || a.job.localeCompare(b.job)
    ));
}
