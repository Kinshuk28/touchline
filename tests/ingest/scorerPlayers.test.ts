import { describe, it, expect } from 'vitest';
import { newPlayersFromScorers } from '@/lib/ingest/scorerPlayers';
import type { RawScorer } from '@/lib/providers/types';

function scorer(overrides: Partial<RawScorer> = {}): RawScorer {
  return {
    playerFdId: 1,
    playerName: 'Test Player',
    teamFdId: 100,
    goals: 5,
    assists: 2,
    playedMatches: 10,
    firstName: 'Test',
    lastName: 'Player',
    dateOfBirth: '2000-01-01',
    nationality: 'Testland',
    position: null,
    shirtNumber: 9,
    ...overrides,
  };
}

describe('newPlayersFromScorers', () => {
  it('creates a row for a scorer whose playerFdId is not already in the player-id map', () => {
    const rows = newPlayersFromScorers([scorer()], new Map([[100, 7]]), new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fd_id: 1,
      fpl_id: null,
      team_id: 7,
      name: 'Test Player',
      nationality: 'Testland',
      date_of_birth: '2000-01-01',
      photo_url: null,
    });
  });

  it('skips a scorer whose playerFdId already resolves in the player-id map — this is the case that keeps a re-run from re-creating an existing player', () => {
    const rows = newPlayersFromScorers([scorer({ playerFdId: 42 })], new Map(), new Map([[42, 999]]));
    expect(rows).toHaveLength(0);
  });

  it('follows the exact slug convention `${slugify(name)}-${fdId}` used by the backfill\'s squad-based players, so a duplicate row never appears if the player later shows up in a real squad', () => {
    const rows = newPlayersFromScorers(
      [scorer({ playerFdId: 3374, playerName: 'Kylian Mbappé' })],
      new Map(),
      new Map(),
    );
    expect(rows[0]!.slug).toBe('kylian-mbappe-3374');
  });

  it('resolves team_id from the scorer\'s teamFdId via the team-id map, and leaves it null when the team is unresolved rather than guessing', () => {
    const rows = newPlayersFromScorers(
      [scorer({ playerFdId: 1, teamFdId: 999 }), scorer({ playerFdId: 2, teamFdId: 100 })],
      new Map([[100, 55]]),
      new Map(),
    );
    const unresolved = rows.find((r) => r.fd_id === 1)!;
    const resolved = rows.find((r) => r.fd_id === 2)!;
    expect(unresolved.team_id).toBeNull();
    expect(resolved.team_id).toBe(55);
  });

  it('passes bio fields through as null when the payload has null, never fabricating a value', () => {
    const rows = newPlayersFromScorers(
      [scorer({ position: null, nationality: null, dateOfBirth: null })],
      new Map(),
      new Map(),
    );
    expect(rows[0]!.position).toBeNull();
    expect(rows[0]!.nationality).toBeNull();
    expect(rows[0]!.date_of_birth).toBeNull();
  });

  it('never sets photo_url — football-data.org provides no player photography', () => {
    const rows = newPlayersFromScorers([scorer()], new Map(), new Map());
    expect(rows[0]!.photo_url).toBeNull();
  });

  it('dedupes a repeated playerFdId within the same call, keeping one row rather than two that would collide on the fd_id conflict target', () => {
    const rows = newPlayersFromScorers(
      [scorer({ playerFdId: 5, playerName: 'A' }), scorer({ playerFdId: 5, playerName: 'A (dup)' })],
      new Map(),
      new Map(),
    );
    expect(rows).toHaveLength(1);
  });
});
