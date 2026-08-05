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

// Mirrors the real shape confirmed against the project's own database: 23
// stored Premier League clubs (some retained from prior seasons) against
// FPL's 20 current teams for a season. Module-scoped (not inside a single
// `describe`) so both `matchFplTeamsToClubs` and the dedicated Nottingham
// Forest exception block below share the exact same club list.
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

describe('matchFplTeamsToClubs', () => {
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

  // Nottingham Forest's own name/short-code pair (football-data's `NOT` vs
  // FPL's `NFO`) genuinely disagrees on both axes — candidate-key matching
  // alone cannot and should not resolve it; the dedicated exception block
  // further down (`FPL_TEAM_NAME_EXCEPTIONS`) is what actually fixes this
  // one club, and is tested separately there.
  it('honestly reports an unmatched club when the name and short code both disagree, and it has no exception entry', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 50, name: 'Some Other Club', shortName: 'SOC' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.has(50)).toBe(false);
    expect(unmatched.map((t) => t.name)).toEqual(['Some Other Club']);
  });

  it('does not silently drop a report of an unmatched team with no exception and no shared key', () => {
    const fplTeams: FplTeamRef[] = [
      { fplId: 1, name: 'Arsenal', shortName: 'ARS' },
      { fplId: 99, name: 'Nonexistent City', shortName: 'XXX' },
    ];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.size).toBe(1);
    expect(unmatched.map((t) => t.name)).toEqual(['Nonexistent City']);
  });
});

// The Nottingham Forest exception (lib/ingest/playerIdentity.ts's
// FPL_TEAM_NAME_EXCEPTIONS): before this fix, "Nott'm Forest" fell into
// `unmatched` on every run (see the "still cannot resolve ... via candidate
// keys alone" test above), which orphaned that club's entire squad from
// `team_id` in scripts/ingest/players.ts — 23 players and growing each run,
// per the club's fpl_id never getting a home. This block is the regression
// test for the fix: a single, documented, hardcoded mapping, not a general
// alias table and not fuzzy matching (see the constant's doc comment for
// why fuzzy matching was rejected — it false-matched on generic tokens like
// "city").
describe('Nottingham Forest exception (documented upstream naming mismatch)', () => {
  it('resolves "Nott\'m Forest" onto the stored "Nottingham Forest FC" club despite the name and short-code both disagreeing', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 18, name: "Nott'm Forest", shortName: 'NFO' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(18)).toBe(7);
    expect(unmatched).toHaveLength(0);
  });

  it('is case-insensitive, matching FPL\'s exact team name regardless of case', () => {
    const fplTeams: FplTeamRef[] = [{ fplId: 18, name: "NOTT'M FOREST", shortName: 'NFO' }];
    const { teamIdByFplTeamId } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(18)).toBe(7);
  });

  it('still works alongside other clubs matched normally, in the same call', () => {
    const fplTeams: FplTeamRef[] = [
      { fplId: 1, name: 'Arsenal', shortName: 'ARS' },
      { fplId: 18, name: "Nott'm Forest", shortName: 'NFO' },
      { fplId: 99, name: 'Nonexistent City', shortName: 'XXX' },
    ];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.get(1)).toBe(1);
    expect(teamIdByFplTeamId.get(18)).toBe(7);
    expect(unmatched.map((t) => t.name)).toEqual(['Nonexistent City']);
  });

  it('does not fire for an unrelated club whose name merely contains a shared word', () => {
    // Guards against the exception degrading into fuzzy matching: a club
    // that isn't the literal "Nott'm Forest" string must never resolve via
    // this path, even if it shares a token with the exception's key.
    const fplTeams: FplTeamRef[] = [{ fplId: 50, name: 'Forest City', shortName: 'FOR' }];
    const { teamIdByFplTeamId, unmatched } = matchFplTeamsToClubs(fplTeams, clubs);
    expect(teamIdByFplTeamId.has(50)).toBe(false);
    expect(unmatched.map((t) => t.name)).toEqual(['Forest City']);
  });
});

// Player-name matching itself (matchFplPlayersByName) moved to
// lib/ingest/playerMatch.ts (matchPlayersTiered) — see
// tests/ingest/playerMatch.test.ts.
