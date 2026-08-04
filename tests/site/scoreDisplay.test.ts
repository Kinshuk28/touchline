import { describe, it, expect } from 'vitest';
import { scoreCellText, stateLabel } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams } from '@/lib/site/rows';

const now = new Date('2026-08-16T15:00:00Z');

function fixture(overrides: Partial<FixtureWithTeams>): FixtureWithTeams {
  return {
    id: 1, league_id: 1, season: 2026, kickoff_utc: '2026-08-16T14:00:00Z',
    status: 'SCHEDULED', matchday: 1, home_goals: null, away_goals: null,
    updated_at: '2026-08-16T14:00:00Z', home: null, away: null,
    ...overrides,
  };
}

describe('scoreCellText', () => {
  it('shows the score for a 0-0 finished match, not the kickoff time', () => {
    expect(scoreCellText(fixture({ status: 'FINISHED', home_goals: 0, away_goals: 0 }), now)).toBe('0–0');
  });

  it('shows the kickoff time for an unplayed match', () => {
    expect(scoreCellText(fixture({ status: 'SCHEDULED', kickoff_utc: '2026-08-16T19:00:00Z' }), now)).toBe('19:00');
  });

  it('shows a dash for a postponed match rather than a score or a time', () => {
    expect(scoreCellText(fixture({ status: 'POSTPONED' }), now)).toBe('—');
  });

  it('shows the live score for an in-play match', () => {
    expect(scoreCellText(fixture({ status: 'IN_PLAY', home_goals: 1, away_goals: 0 }), now)).toBe('1–0');
  });
});

describe('stateLabel', () => {
  it('reports live for IN_PLAY', () => {
    expect(stateLabel(fixture({ status: 'IN_PLAY' }))).toEqual({ text: 'Live', live: true });
  });

  it('reports live for PAUSED', () => {
    expect(stateLabel(fixture({ status: 'PAUSED' }))).toEqual({ text: 'Live', live: true });
  });

  it('shows a Postponed label, not live', () => {
    expect(stateLabel(fixture({ status: 'POSTPONED' }))).toEqual({ text: 'Postponed', live: false });
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
