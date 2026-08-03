import 'dotenv/config';
import { loadEnv } from '@/lib/config/env';
import { RateLimiter } from '@/lib/ingest/rateLimiter';
import { FootballDataClient } from '@/lib/providers/footballData';
import { LEAGUE_SEEDS } from '@/lib/ingest/leagueSeed';
import { slugify } from '@/lib/db/slug';
import { getTeamIdMap } from '@/lib/db/repositories/teams';
import { upsertPlayersByFdId } from '@/lib/db/repositories/players';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const env = loadEnv();
const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000 });
const fd = new FootballDataClient({ apiKey: env.FOOTBALL_DATA_KEY, limiter });

const runId = await startRun('squads');
let requests = 0;
const skipped: string[] = [];

try {
  const teamIds = await getTeamIdMap();

  // Current clubs only, sourced the same way `scripts/backfill.ts` phase 2
  // does: each competition's `/teams` endpoint lists exactly the clubs
  // still in that competition this season. A club that dropped out of
  // every competition the free tier covers (e.g. relegated at the end of
  // last season — RCD Mallorca, FC St. Pauli, AC Pisa 1909) is simply
  // absent from these lists, so it is never queued for a squad fetch at
  // all. This deliberately replaces a plain
  // `serviceClient().from('teams').select('fd_id')`: that query cannot
  // distinguish a current club from a historical one (the `teams` table
  // carries both, and has no "is current" column), so filtering after the
  // fact would mean either shipping an extra DB round trip on top of these
  // 5 requests, or leaning on the 403 catch below as the *only* signal for
  // "this club shouldn't be queried" — fragile, since a 403 can't be
  // distinguished from a transient provider error without inspecting the
  // status code, which the catch already has to do anyway. Sourcing the
  // roster from the provider's own "who's currently in this competition"
  // endpoint is the same zero-ambiguity approach the backfill already
  // uses, and it also means squads.ts never performs an unbounded select
  // against `teams` — see getTeamIdMap() below for the one DB read this
  // script does need, which already pages via `fetchAllRows`.
  const currentFdIds = new Set<number>();
  for (const s of LEAGUE_SEEDS) {
    const teams = await fd.getCompetitionTeams(s.code); requests++;
    for (const team of teams) currentFdIds.add(team.fdId);
  }

  let players = 0;
  let clubsFetched = 0;
  for (const fdId of currentFdIds) {
    let result: Awaited<ReturnType<typeof fd.getSquad>>;
    try {
      result = await fd.getSquad(fdId); requests++;
    } catch (err) {
      // A 403 on an individual club must not abort the whole run: catch
      // it, log which club was skipped, count it, and continue. Anything
      // that isn't a 403 (e.g. 429, 500) is a real failure and must still
      // fail loudly — see scripts/backfill.ts phase 5 for the same rule.
      const message = err instanceof Error ? err.message : String(err);
      if (/football-data\.org 403 /.test(message)) {
        skipped.push(String(fdId));
        console.warn(`squads: skipped (403) fd_id ${fdId}`);
        continue;
      }
      throw err;
    }

    const { team, squad } = result;
    await upsertPlayersByFdId(squad.map((p) => ({
      fd_id: p.fdId, fpl_id: null, team_id: teamIds.get(team.fdId) ?? null,
      slug: `${slugify(p.name)}-${p.fdId}`, name: p.name, position: p.position,
      nationality: p.nationality, date_of_birth: p.dateOfBirth, photo_url: null,
    })));
    players += squad.length;
    clubsFetched++;
  }

  const message = `${clubsFetched}/${currentFdIds.size} clubs, ${players} players, ${skipped.length} skipped (403)`;
  await finishRun(runId, 'ok', message, requests);
  console.log(`squads done: ${message}, ${requests} requests`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, requests);
  console.error('squads failed:', message);
  process.exit(1);
}
