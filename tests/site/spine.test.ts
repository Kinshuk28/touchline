import { describe, it, expect } from 'vitest';
import { dayRailParts, spineCenterText, spineRowKind } from '@/lib/site/spine';
import type { FixtureStatus } from '@/lib/providers/types';

function fixture(overrides: { status: FixtureStatus; home_goals?: number | null; away_goals?: number | null }) {
  return { status: overrides.status, home_goals: overrides.home_goals ?? null, away_goals: overrides.away_goals ?? null };
}

describe('spineRowKind', () => {
  it('is upcoming for a scheduled fixture with no score', () => {
    expect(spineRowKind(fixture({ status: 'SCHEDULED' }))).toBe('upcoming');
    expect(spineRowKind(fixture({ status: 'TIMED' }))).toBe('upcoming');
  });

  it('is live for IN_PLAY/PAUSED, regardless of whether a score is already set', () => {
    expect(spineRowKind(fixture({ status: 'IN_PLAY', home_goals: 1, away_goals: 0 }))).toBe('live');
    expect(spineRowKind(fixture({ status: 'PAUSED', home_goals: 0, away_goals: 0 }))).toBe('live');
  });

  it('is played for a fixture with a genuine score pair, including a real 0-0', () => {
    expect(spineRowKind(fixture({ status: 'FINISHED', home_goals: 2, away_goals: 1 }))).toBe('played');
    expect(spineRowKind(fixture({ status: 'FINISHED', home_goals: 0, away_goals: 0 }))).toBe('played');
    expect(spineRowKind(fixture({ status: 'AWARDED', home_goals: 3, away_goals: 0 }))).toBe('played');
  });

  it('is postponed for POSTPONED/CANCELLED/SUSPENDED, even if a score happens to be set', () => {
    expect(spineRowKind(fixture({ status: 'POSTPONED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'CANCELLED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'SUSPENDED' }))).toBe('postponed');
    expect(spineRowKind(fixture({ status: 'SUSPENDED', home_goals: 1, away_goals: 1 }))).toBe('postponed');
  });

  it('never claims "played" from status alone — a null score always falls through', () => {
    expect(spineRowKind(fixture({ status: 'FINISHED' }))).toBe('upcoming');
  });
});

describe('spineCenterText', () => {
  it('shows the score for played and live kinds', () => {
    expect(spineCenterText({ home_goals: 2, away_goals: 1 }, 'played')).toBe('2–1');
    expect(spineCenterText({ home_goals: 0, away_goals: 0 }, 'live')).toBe('0–0');
  });

  it('shows an em dash for upcoming and postponed kinds', () => {
    expect(spineCenterText({ home_goals: null, away_goals: null }, 'upcoming')).toBe('—');
    expect(spineCenterText({ home_goals: null, away_goals: null }, 'postponed')).toBe('—');
  });
});

describe('dayRailParts', () => {
  it('parses a YYYY-MM-DD group key into day/month/weekday', () => {
    // 2026-08-16 is a Sunday.
    expect(dayRailParts('2026-08-16')).toEqual({ day: 16, month: 'Aug', weekday: 'Sun' });
  });

  it('parses the year boundary correctly', () => {
    expect(dayRailParts('2026-01-01')).toEqual({ day: 1, month: 'Jan', weekday: 'Thu' });
  });
});
