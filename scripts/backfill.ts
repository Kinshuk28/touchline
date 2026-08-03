import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, CURRENT_SEASON, PREVIOUS_SEASON } from '@/lib/ingest/leagueSeed';
import { slugify } from '@/lib/db/slug';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap, type TeamRow } from '@/lib/db/repositories/teams';
import { upsertPlayersByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import type { RawSquadMember } from '@/lib/providers/types';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('backfill');
let requests = 0;

try {
  console.log('1/4  seeding leagues');
  await upsertLeagues(LEAGUE_SEEDS.map((s) => ({
    fd_code: s.code, fd_id: s.fdId, slug: s.slug, name: s.name, country: s.country,
    emblem_url: `https://crests.football-data.org/${s.code}.png`,
    current_season: CURRENT_SEASON, season_start: null, season_end: null,
  })));
  const leagueIds = await getLeagueIdMap();

  // Phase 1: discover every club and its squad. Last season's table is the
  // cheapest complete roster of clubs in a league (the current table may be
  // empty before matchday 1).
  console.log('2/4  clubs and squads');
  const collectedTeams: TeamRow[] = [];
  const collectedSquads: Array<{ teamFdId: number; squad: RawSquadMember[] }> = [];

  for (const s of LEAGUE_SEEDS) {
    const table = await fd.getStandings(s.code, PREVIOUS_SEASON); requests++;
    const leagueId = leagueIds.get(s.code)!;
    for (const row of table) {
      const { team, squad } = await fd.getSquad(row.teamFdId); requests++;
      collectedTeams.push({
        fd_id: team.fdId, league_id: leagueId, slug: slugify(team.name), name: team.name,
        short_name: team.shortName, tla: team.tla, crest_url: team.crestUrl,
        venue: team.venue, founded: team.founded, club_colors: team.clubColors,
      });
      collectedSquads.push({ teamFdId: team.fdId, squad });
    }
    console.log(`     ${s.code}: ${table.length} clubs`);
  }

  // Phase 2: write clubs, then resolve ids ONCE, then write players.
  await upsertTeams(collectedTeams);
  const teamIds = await getTeamIdMap();

  await upsertPlayersByFdId(collectedSquads.flatMap(({ teamFdId, squad }) =>
    squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(teamFdId) ?? null,
      slug: `${slugify(p.name)}-${p.fdId}`, name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    }))));
  console.log(`     ${collectedTeams.length} clubs, ${collectedSquads.reduce((n, c) => n + c.squad.length, 0)} players`);

  // Phase 3: fixtures for both seasons. Fetched once each, not twice.
  console.log('3/4  fixtures');
  for (const s of LEAGUE_SEEDS) {
    for (const season of [PREVIOUS_SEASON, CURRENT_SEASON]) {
      const matches = await fd.getMatches(s.code, season); requests++;
      await upsertFixtures(matches.map((m) => ({
        fd_id: m.fdId, league_id: leagueIds.get(s.code)!,
        home_team_id: teamIds.get(m.homeTeamFdId) ?? null,
        away_team_id: teamIds.get(m.awayTeamFdId) ?? null,
        season, kickoff_utc: m.kickoffUtc, status: m.status, matchday: m.matchday,
        home_goals: m.homeGoals, away_goals: m.awayGoals,
        half_time_home: m.halfTimeHome, half_time_away: m.halfTimeAway,
        last_updated: m.lastUpdated, updated_at: now(),
      })));
      console.log(`     ${s.code} ${season}: ${matches.length} fixtures`);
    }
  }

  console.log('4/4  last season final tables');
  for (const s of LEAGUE_SEEDS) {
    const rows = await fd.getStandings(s.code, PREVIOUS_SEASON); requests++;
    await upsertStandings(rows.map((r) => ({
      league_id: leagueIds.get(s.code)!, team_id: teamIds.get(r.teamFdId)!,
      season: PREVIOUS_SEASON, position: r.position, played: r.played, won: r.won,
      drawn: r.drawn, lost: r.lost, goals_for: r.goalsFor, goals_against: r.goalsAgainst,
      goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
    })).filter((r) => r.team_id !== undefined));
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`\nBackfill complete. ${requests} requests used.`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('\nBackfill failed:', message);
  process.exit(1);
}
