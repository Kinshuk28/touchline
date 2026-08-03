import { describe, it, expect } from 'vitest';
import {
  normaliseClubName,
  matchFplTeamsToClubs,
  type ClubRef,
  type FplTeamRef,
} from '@/lib/ingest/playerIdentity';

describe('normaliseClubName', () => {
  it('strips the FC/AFC/CF club-suffix convention', () => {
    expect(normaliseClubName('Arsenal FC')).toBe('arsenal');
    expect(normaliseClubName('AFC Bournemouth')).toBe('bournemouth');
    expect(normaliseClubName('Manchester City FC')).toBe('manchester-city');
  });

  it('leaves a name with no suffix convention unchanged (other than slugifying)', () => {
    expect(normaliseClubName('Arsenal')).toBe('arsenal');
    expect(normaliseClubName('Man City')).toBe('man-city');
  });
});

describe('matchFplTeamsToClubs', () => {
  // Mirrors the real shape confirmed against the project's own database: 23
  // stored Premier League clubs (some retained from prior seasons) against
  // FPL's 20 current teams for a season.
  const clubs: ClubRef[] = [
    { id: 1, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS' },
    { id: 2, name: 'AFC Bournemouth', shortName: 'Bournemouth', tla: 'BOU' },
    { id: 3, name: 'Manchester City FC', shortName: 'Man City', tla: 'MCI' },
    { id: 4, name: 'Manchester United FC', shortName: 'Man United', tla: 'MUN' },
    { id: 5, name: 'Tottenham Hotspur FC', shortName: 'Tottenham', tla: 'TOT' },
    { id: 6, name: 'Leeds United FC', shortName: 'Leeds United', tla: 'LEE' },
    { id: 7, name: 'Nottingham Forest FC', shortName: 'Nottingham', tla: 'NOT' },
    { id: 8, name: 'Burnley FC', shortName: 'Burnley', tla: 'BUR' }, // not an FPL team this season
  ];

  it('matches a club whose full name normalises identically (Arsenal)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 1, name: 'Arsenal', shortName: 'ARS' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(1)).toBe(1);
    expect(unmatched).toHaveLength(0);
  });

  it('matches a club whose full name has an AFC prefix (Bournemouth)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 3, name: 'Bournemouth', shortName: 'BOU' }];
    const { teamIdByFplTeamId } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(3)).toBe(2);
  });

  it('matches via the short code when the FPL nickname shares nothing with the full name (Spurs vs Tottenham Hotspur FC)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 19, name: 'Spurs', shortName: 'TOT' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(19)).toBe(5);
    expect(unmatched).toHaveLength(0);
  });

  it('matches via the short code even when the informal names disagree (Man Utd vs Man United)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 16, name: 'Man Utd', shortName: 'MUN' }];
    const { teamIdByFplTeamId } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(16)).toBe(4);
  });

  it('matches via the short code even when the full name normalises to something entirely different (Leeds vs Leeds United FC)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 13, name: 'Leeds', shortName: 'LEE' }];
    const { teamIdByFplTeamId } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(13)).toBe(6);
  });

  it('honestly reports a club as unmatched when both the name and the short code disagree (Nottingham Forest: NOT vs NFO)', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 18, name: "Nott'm Forest", shortName: 'NFO' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.has(18)).toBe(false);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.name).toBe("Nott'm Forest");
  });

  it('does not silently drop a report of every unmatched team when several fail at once', () => {
    const fplTeams: FplTeamRef[] = [
      { fplId: 1, name: 'Arsenal', shortName: 'ARS' },
      { fplId: 18, name: "Nott'm Forest", shortName: 'NFO' },
      { fplId: 99, name: 'Nonexistent City', shortName: 'XXX' },
    ];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.size).toBe(1);
    expect(unmatched.map((t) => t.name).sort()).toEqual(["Nonexistent City", "Nott'm Forest"].sort());
  });
});

// Player-name matching itself (matchFplPlayersByName) moved to
// lib/ingest/playerMatch.ts (matchPlayersTiered) — see
// tests/ingest/playerMatch.test.ts.
