import { describe, it, expect } from 'vitest';
import { JOB_CADENCE_MINUTES, jobHealth, sortRunsByHealth } from '@/lib/site/ingestHealth';
import type { IngestRun } from '@/lib/site/queries/status';

const now = new Date('2026-08-07T12:00:00Z');

function run(overrides: Partial<IngestRun> & { job: string }): IngestRun {
  return {
    id: 1,
    status: 'ok',
    message: null,
    requests_used: 0,
    started_at: '2026-08-07T11:55:00Z',
    finished_at: '2026-08-07T11:55:30Z',
    ...overrides,
  };
}

describe('jobHealth', () => {
  it('is ok for a recent successful run', () => {
    expect(jobHealth(run({ job: 'ingest-news' }), now)).toBe('ok');
  });

  it('is failed for a finished run that did not succeed', () => {
    expect(jobHealth(run({ job: 'ingest-news', status: 'error' }), now)).toBe('failed');
  });

  it('is running — not failed — for an unfinished run', () => {
    expect(jobHealth(run({ job: 'ingest-news', status: 'started', finished_at: null }), now)).toBe('running');
  });

  it('calls a job stale when its last success is well past its own cadence', () => {
    // ingest-news runs every 15 minutes; 3 hours is far beyond 3x that.
    const old = run({ job: 'ingest-news', started_at: '2026-08-07T09:00:00Z', finished_at: '2026-08-07T09:00:30Z' });
    expect(jobHealth(old, now)).toBe('stale');
  });

  it('tolerates a missed tick rather than crying wolf', () => {
    // One skipped 15-minute run (GitHub drops scheduled runs routinely) is
    // within the 3x window.
    const recent = run({ job: 'ingest-news', started_at: '2026-08-07T11:30:00Z' });
    expect(jobHealth(recent, now)).toBe('ok');
  });

  it('respects each job\'s own cadence — a 12-hourly job is not stale at 3 hours', () => {
    const players = run({ job: 'ingest-players', started_at: '2026-08-07T09:00:00Z' });
    expect(JOB_CADENCE_MINUTES['ingest-players']).toBe(720);
    expect(jobHealth(players, now)).toBe('ok');
  });

  it('never guesses at a job it has no schedule for', () => {
    const unknown = run({ job: 'ingest-something-new', started_at: '2020-01-01T00:00:00Z' });
    expect(jobHealth(unknown, now)).toBe('ok');
  });
});

describe('sortRunsByHealth', () => {
  it('puts what is wrong at the top', () => {
    const runs = [
      run({ job: 'ingest-core' }),
      run({ job: 'ingest-news', status: 'error' }),
      run({ job: 'ingest-live', started_at: '2026-08-06T00:00:00Z' }),
      run({ job: 'ingest-squads', status: 'started', finished_at: null }),
    ];
    expect(sortRunsByHealth(runs, now).map((r) => r.job))
      .toEqual(['ingest-news', 'ingest-live', 'ingest-squads', 'ingest-core']);
  });

  it('does not mutate its input', () => {
    const runs = [run({ job: 'b' }), run({ job: 'a', status: 'error' })];
    sortRunsByHealth(runs, now);
    expect(runs.map((r) => r.job)).toEqual(['b', 'a']);
  });
});
