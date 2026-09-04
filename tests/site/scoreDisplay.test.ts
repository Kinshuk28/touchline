import { describe, it, expect } from 'vitest';
import { scoreCellText, stateLabel } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams } from '@/lib/site/rows';

const now = new Date('2026-08-16T15:00:00Z');

function fixture(overrides: Partial<FixtureWithTeams>): FixtureWithTeams {
  return {
    id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
    status: 'SCHEDULED', matchday: 1, home_goals: null, away_goals: null,
    half_time_home: null, half_time_away: null,
    updated_at: '2026-08-16T14:00:00Z', home: null, away: null,
    ...overrides,
  };
}

describe('scoreCellText', () => {
  it('shows the score for a 0-0 finished match, not the kickoff time', () => {
    expect(scoreCellText(fixture({ status: 'FINISHED', home_goals: 0, away_goals: 0 }), now)).toBe('0–0');
  });

  it('shows the kickoff time for an unplayed match', () => {
    // now is 2026-08-16T15:00:00Z (20:30 IST); one hour later is 21:30 IST,
    // same IST calendar day, still in the future.
    const kickoff = new Date(now.getTime() + 60 * 60_000).toISOString();
    expect(scoreCellText(fixture({ status: 'SCHEDULED', kickoff_utc: kickoff }), now)).toBe('21:30');
  });

  it('shows a dash for a postponed match rather than a score or a time', () => {
    expect(scoreCellText(fixture({ status: 'POSTPONED' }), now)).toBe('—');
  });

  it('shows the live score for an in-play match', () => {
    expect(scoreCellText(fixture({ status: 'IN_PLAY', home_goals: 1, away_goals: 0 }), now)).toBe('1–0');
  });

  it('shows a date and time together for a kickoff more than a week out (Important 3)', () => {
    expect(scoreCellText(fixture({ status: 'SCHEDULED', kickoff_utc: '2026-10-01T13:30:00Z' }), now)).toBe('1 Oct 19:00');
  });

  // Important 7: a fixture whose kickoff has passed but is still SCHEDULED
  // or TIMED — the normal state for up to a few minutes given the ingest
  // cadence — must read honestly rather than showing a stale kickoff time
  // or inventing a score.
  it('shows "Kicked off" for a TIMED fixture 10 minutes past its kickoff, not a stale time or a score', () => {
    const kickoff = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(scoreCellText(fixture({ status: 'TIMED', kickoff_utc: kickoff }), now)).toBe('Kicked off');
  });

  it('shows "Kicked off" for a SCHEDULED fixture just past its kickoff too', () => {
    const kickoff = new Date(now.getTime() - 1 * 60_000).toISOString();
    expect(scoreCellText(fixture({ status: 'SCHEDULED', kickoff_utc: kickoff }), now)).toBe('Kicked off');
  });

  it('still shows the kickoff time for a SCHEDULED fixture whose kickoff has not arrived yet', () => {
    const kickoff = new Date(now.getTime() + 10 * 60_000).toISOString();
    // now is 2026-08-16T15:00:00Z (20:30 IST); +10 min is 15:10 UTC = 20:40 IST.
    expect(scoreCellText(fixture({ status: 'SCHEDULED', kickoff_utc: kickoff }), now)).toBe('20:40');
  });
});

describe('stateLabel', () => {
  it('reports live for IN_PLAY', () => {
    expect(stateLabel(fixture({ status: 'IN_PLAY' }))).toEqual({ text: 'Live', live: true });
  });

  it('reports HT for PAUSED, not live — nothing is happening on the pitch at half-time', () => {
    expect(stateLabel(fixture({ status: 'PAUSED' }))).toEqual({ text: 'HT', live: false });
  });

  it('shows a Postp. label, not live', () => {
    expect(stateLabel(fixture({ status: 'POSTPONED' }))).toEqual({ text: 'Postp.', live: false });
  });

  it('shows Off for cancelled and suspended matches', () => {
    expect(stateLabel(fixture({ status: 'CANCELLED' }))).toEqual({ text: 'Off', live: false });
    expect(stateLabel(fixture({ status: 'SUSPENDED' }))).toEqual({ text: 'Off', live: false });
  });

  it('shows FT for a finished match', () => {
    expect(stateLabel(fixture({ status: 'FINISHED' }))).toEqual({ text: 'FT', live: false });
  });

  it('shows FT for an awarded match', () => {
    expect(stateLabel(fixture({ status: 'AWARDED' }))).toEqual({ text: 'FT', live: false });
  });

  it('returns null for an unplayed scheduled or timed match', () => {
    expect(stateLabel(fixture({ status: 'SCHEDULED' }))).toBeNull();
    expect(stateLabel(fixture({ status: 'TIMED' }))).toBeNull();
  });
});
