import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS, CURRENT_SEASON, PREVIOUS_SEASON } from '@/lib/ingest/leagueSeed';
import { slugWithFdId } from '@/lib/db/slug';
import { upsertLeagues, getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertTeams, getTeamIdMap, type TeamRow } from '@/lib/db/repositories/teams';
import { upsertPlayersByFdId } from '@/lib/db/repositories/players';
import { upsertFixtures } from '@/lib/db/repositories/fixtures';
import { upsertStandings } from '@/lib/db/repositories/standings';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import type { RawStanding } from '@/lib/providers/types';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });
const now = () => new Date().toISOString();

const runId = await startRun('backfill');
let requests = 0;
const squadSkips: string[] = [];

try {
  // Phase 1: leagues.
  console.log('1/7  seeding leagues');
  await upsertLeagues(LEAGUE_SEEDS.map((s) => ({
    fd_code: s.code, fd_id: s.fdId, slug: s.slug, name: s.name, country: s.country,
    emblem_url: `https://crests.football-data.org/${s.code}.png`,
    current_season: CURRENT_SEASON, season_start: null, season_end: null,
  })));
  const leagueIds = await getLeagueIdMap();

  // Phase 2: current clubs, straight from each competition's teams
  // endpoint. This is the free-tier-safe source of full club metadata (id,
  // name, shortName, tla, crest, venue, founded, clubColors) for the clubs
  // still in a covered competition. It deliberately does NOT reach for
  // /teams/{id} per club: that endpoint 403s for any club that has dropped
  // out of every competition the free tier covers (e.g. relegated at the
  // end of last season) — confirmed live for RCD Mallorca (id 89), while
  // Real Madrid (id 86) is fine. Mallorca is simply absent from this
  // listing, which is the correct signal to defer to phase 3.
  console.log('2/7  current clubs');
  const currentTeams: TeamRow[] = [];
  const seenFdIds = new Set<number>();
  for (const s of LEAGUE_SEEDS) {
    requests++;
    const teams = await fd.getCompetitionTeams(s.code);
    const leagueId = leagueIds.get(s.code)!;
    for (const team of teams) {
      currentTeams.push({
        // `-${fdId}` suffix, matching the players.slug convention (see
        // scripts/ingest/squads.ts): teams.slug is `unique not null`, and two
        // clubs slugifying identically (no collision today across 110
        // clubs, but promotion/relegation churn makes one live eventually)
        // would otherwise abort this entire upsertTeams batch.
        fd_id: team.fdId, league_id: leagueId, slug: slugWithFdId(team.name, team.fdId), name: team.name,
        short_name: team.shortName, tla: team.tla, crest_url: team.crestUrl,
        venue: team.venue, founded: team.founded, club_colors: team.clubColors,
      });
      seenFdIds.add(team.fdId);
    }
    console.log(`     ${s.code}: ${teams.length} current clubs`);
  }
  await upsertTeams(currentTeams);

  // Phase 3: historical clubs, from last season's standings. Any club in
  // that table not already seen in phase 2 was relegated (or otherwise
  // dropped) out of every competition the free tier covers, so it can never
  // be looked up by id. The standings row's embedded `team` object still
  // carries name/shortName/tla/crest, so its identity can be written with
  // zero extra requests — no call to /teams/{id} ever happens for it.
  // venue/founded/clubColors genuinely are not present in this payload, so
  // they are left null rather than invented.
  console.log('3/7  historical clubs (last season standings)');
  const historicalTeams: TeamRow[] = [];
  const standingsByLeague = new Map<string, RawStanding[]>();
  for (const s of LEAGUE_SEEDS) {
    requests++;
    const table = await fd.getStandings(s.code, PREVIOUS_SEASON);
    standingsByLeague.set(s.code, table);
    const leagueId = leagueIds.get(s.code)!;
    for (const row of table) {
      if (seenFdIds.has(row.teamFdId)) continue;
      historicalTeams.push({
        // Same `-${fdId}` convention as currentTeams above — see that
        // comment for why the plain slug is unsafe long-term.
        fd_id: row.teamFdId, league_id: leagueId, slug: slugWithFdId(row.teamName, row.teamFdId), name: row.teamName,
        short_name: row.teamShortName, tla: row.teamTla, crest_url: row.teamCrestUrl,
        venue: null, founded: null, club_colors: null,
      });
      seenFdIds.add(row.teamFdId);
    }
    console.log(`     ${s.code}: ${table.length} clubs in last season's table`);
  }
  await upsertTeams(historicalTeams);
  console.log(`     ${currentTeams.length} current + ${historicalTeams.length} historical-only clubs`);

  // Phase 4: resolve every club's database id ONCE, now that both current
  // and historical clubs have been written. Never inside a loop.
  console.log('4/7  resolving team ids');
  const teamIds = await getTeamIdMap();

  // Phase 5: squads for the current clubs only. A relegated club has no
  // squad written — correct, since only its identity is needed for the
  // historical standings table. A 403 on any individual club must not abort
  // the run: catch it, log which club was skipped, count it, and continue.
  // Anything that isn't a 403 (e.g. 429, 500) is a real failure and must
  // still fail loudly.
  console.log('5/7  squads (current clubs)');
  const collectedSquads: Array<{ teamFdId: number; squad: Awaited<ReturnType<typeof fd.getSquad>>['squad'] }> = [];
  for (const team of currentTeams) {
    try {
      requests++;
      const { squad } = await fd.getSquad(team.fd_id);
      collectedSquads.push({ teamFdId: team.fd_id, squad });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/football-data\.org 403 /.test(message)) {
        squadSkips.push(`${team.name} (fd_id ${team.fd_id})`);
        console.warn(`     skipped (403): ${team.name} (fd_id ${team.fd_id})`);
        continue;
      }
      throw err;
    }
  }

  await upsertPlayersByFdId(collectedSquads.flatMap(({ teamFdId, squad }) =>
    squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(teamFdId) ?? null,
      slug: slugWithFdId(p.name, p.fdId), name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    }))));
  console.log(`     ${collectedSquads.length}/${currentTeams.length} squads fetched, ${collectedSquads.reduce((n, c) => n + c.squad.length, 0)} players, ${squadSkips.length} skipped (403)`);

  // Phase 6: fixtures for both seasons, both leagues. Fetched once each,
  // not twice.
  console.log('6/7  fixtures');
  for (const s of LEAGUE_SEEDS) {
    for (const season of [PREVIOUS_SEASON, CURRENT_SEASON]) {
      requests++;
      const matches = await fd.getMatches(s.code, season);
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

  // Phase 7: last season's final tables, using the standings rows already
  // fetched in phase 3 — no re-fetch. With phase 3 in place every club in
  // this table now has a database row, so a lookup miss here is a real bug,
  // not an expected gap. Log it loudly by name rather than silently
  // dropping the table row (a silently short league table is exactly the
  // kind of bug that looks fine until someone counts the rows).
  console.log('7/7  last season final tables');
  for (const s of LEAGUE_SEEDS) {
    const table = standingsByLeague.get(s.code)!;
    const leagueId = leagueIds.get(s.code)!;
    const rows = [];
    for (const r of table) {
      const teamId = teamIds.get(r.teamFdId);
      if (teamId === undefined) {
        console.warn(`     WARNING: unresolved club "${r.teamName}" (fd_id ${r.teamFdId}) in ${s.code} standings — row dropped`);
        continue;
      }
      rows.push({
        league_id: leagueId, team_id: teamId,
        season: PREVIOUS_SEASON, position: r.position, played: r.played, won: r.won,
        drawn: r.drawn, lost: r.lost, goals_for: r.goalsFor, goals_against: r.goalsAgainst,
        goal_difference: r.goalDifference, points: r.points, form: r.form, updated_at: now(),
      });
    }
    await upsertStandings(rows);
    console.log(`     ${s.code}: ${rows.length}/${table.length} standings rows written`);
  }

  await finishRun(runId, 'ok', null, requests);
  console.log(`\nBackfill complete. ${requests} requests used. ${squadSkips.length} squads skipped (403): ${squadSkips.join(', ') || 'none'}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('\nBackfill failed:', message);
  process.exit(1);
}
