import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from '@/lib/db/client';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const live = process.env.RUN_DB_TESTS === '1';
const d = live ? describe : describe.skip;

d('repositories against a real Supabase project', () => {
  beforeAll(async () => {
    await upsertLeagues([{
      fd_code: 'TEST', fd_id: 999999, slug: 'test-league', name: 'Test League',
      country: 'Testland', emblem_url: null, current_season: 2026,
      season_start: '2026-08-01', season_end: '2027-05-01',
    }]);
  });

  // Delete the synthetic rows created by this test file so they never leak into
  // the real backfill (Task 9). Order matters: fixtures/teams reference leagues,
  // so children are removed before the parent.
  afterAll(async () => {
    const db = serviceClient();
    await db.from('fixtures').delete().eq('fd_id', 999997);
    await db.from('teams').delete().eq('fd_id', 999998);
    await db.from('leagues').delete().eq('fd_code', 'TEST');
    await db.from('ingest_run').delete().eq('job', 'test-job');
  });

  it('upserts a league idempotently', async () => {
    await upsertLeagues([{
      fd_code: 'TEST', fd_id: 999999, slug: 'test-league', name: 'Test League Renamed',
      country: 'Testland', emblem_url: null, current_season: 2026,
      season_start: '2026-08-01', season_end: '2027-05-01',
    }]);
    const map = await getLeagueIdMap();
    expect(map.has('TEST')).toBe(true);
  });

  it('upserts teams and returns an id map', async () => {
    const leagueId = (await getLeagueIdMap()).get('TEST')!;
    await upsertTeams([{
      fd_id: 999998, league_id: leagueId, slug: 'test-fc', name: 'Test FC',
      short_name: 'Test', tla: 'TST', crest_url: null, venue: null,
      founded: null, club_colors: null,
    }]);
    expect((await getTeamIdMap()).has(999998)).toBe(true);
  });

  it('upserts a fixture twice without duplicating it', async () => {
    const leagueId = (await getLeagueIdMap()).get('TEST')!;
    const teamId = (await getTeamIdMap()).get(999998)!;
    const row = {
      fd_id: 999997, league_id: leagueId, home_team_id: teamId, away_team_id: teamId,
      season: 2026, kickoff_utc: '2026-09-01T14:00:00Z', status: 'SCHEDULED',
      matchday: 1, home_goals: null, away_goals: null,
      half_time_home: null, half_time_away: null, last_updated: null,
      updated_at: new Date().toISOString(),
    };
    await upsertFixtures([row]);
    await upsertFixtures([{ ...row, status: 'FINISHED', home_goals: 2, away_goals: 1 }]);

    const { data, error } = await serviceClient()
      .from('fixtures').select('fd_id, status, home_goals').eq('fd_id', 999997);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);           // upserted, not duplicated
    expect(data![0]!.status).toBe('FINISHED'); // and the update landed
    expect(data![0]!.home_goals).toBe(2);
  });

  it('records a run', async () => {
    const id = await startRun('test-job');
    await finishRun(id, 'ok', null, 3);
    expect(id).toBeGreaterThan(0);
  });
});
