import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamsByLeagueId } from '@/lib/db/repositories/teams';
import {
  getOrphanFplPlayers,
  getFdPlayersByTeamIds,
  setPlayerFplIdentity,
  setPlayerTeam,
  deletePlayersByIds,
} from '@/lib/db/repositories/players';
import { repointPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { matchFplTeamsToClubs } from '@/lib/ingest/playerIdentity';
import { matchPlayersTiered, type MatchSubject } from '@/lib/ingest/playerMatch';

interface OrphanRef {
  id: number;
  name: string;
  fpl_id: number;
  photo_url: string | null;
}

/**
 * An orphan `players` row carries only what was written at insert time
 * (`name`, `fpl_id`, `photo_url`) -- not FPL's `web_name` or its current
 * club, since the schema has no column for either. Both are required for
 * the tiered matcher, so each orphan is re-joined here against the live
 * `bootstrap-static` payload by `fpl_id` to recover them. An orphan whose
 * `fpl_id` no longer appears in the current bootstrap (the player left the
 * FPL dataset entirely -- retired, relegated out of the league, etc.) gets
 * `teamId: undefined` and an empty `webName`, which the matcher's own rules
 * already turn into an honest miss rather than a guess.
 */
type OrphanMatchSubject = MatchSubject & { orphan: OrphanRef };

/**
 * One-shot repair, run once by hand (like `scripts/ingest/seedScorerPlayers.ts`),
 * not on a schedule. It exists because `scripts/ingest/players.ts` ran with
 * the identity bug for a while before the fix: every FPL player got inserted
 * as a brand-new row (`team_id: null`) instead of being matched onto its
 * existing football-data row, leaving the entire Premier League roster (567
 * rows, confirmed live) floating with no club.
 *
 * This applies the exact same tiered matcher the fixed
 * `scripts/ingest/players.ts` now uses going forward
 * (`lib/ingest/playerMatch.ts`), against rows already sitting in the
 * database, and then either:
 *   - merges a matched orphan onto its football-data row (moves fpl_id +
 *     photo_url, repoints its player_season_stats rows, deletes the orphan), or
 *   - for an orphan with no football-data match, sets team_id from the FPL
 *     team mapping instead so it at least stops being teamless.
 *
 * Ordering matters: player_season_stats.player_id is a foreign key onto
 * players(id), so every stats row referencing an orphan must be repointed
 * onto the surviving row *before* that orphan is deleted -- deleting first
 * would either violate the FK (if it's `restrict`) or, worse, cascade-delete
 * real stats data (the schema uses `on delete cascade`).
 *
 * The one FPL API call this makes (`bootstrap-static`, unmetered, no auth,
 * no football-data.org budget consumed) is what a genuinely-unmatched
 * orphan's team assignment: `players` has no column recording which FPL
 * team a player belongs to, so that has to come from the live bootstrap
 * payload's `elements[].team`, not from anything already in Postgres.
 */
const runId = await startRun('repair-merge-fpl-players');

try {
  const leagueId = (await getLeagueIdMap()).get('PL');
  if (leagueId === undefined) throw new Error('Premier League missing — run backfill first');

  const { players: fplPlayers, teams: fplTeams } = await new FplClient().getBootstrap();
  const clubRows = await getTeamsByLeagueId(leagueId);
  const clubs = clubRows.map((c) => ({ id: c.id, name: c.name, shortName: c.short_name, tla: c.tla }));

  const { teamIdByFplTeamId, unmatched: unmatchedTeams } = matchFplTeamsToClubs(fplTeams, clubs);
  console.log(`repair: FPL team match ${teamIdByFplTeamId.size}/${fplTeams.length}`);
  if (unmatchedTeams.length > 0) {
    console.warn(`repair: unmatched FPL teams: ${unmatchedTeams.map((t) => t.name).join(', ')}`);
  }
  const fplByFplId = new Map(fplPlayers.map((p) => [p.fplId, p]));

  const orphans = await getOrphanFplPlayers();
  console.log(`repair: ${orphans.length} orphan FPL rows found`);

  const existingPlayers = await getFdPlayersByTeamIds(clubs.map((c) => c.id));
  const candidates = existingPlayers.map((p) => ({ id: p.id, name: p.name, teamId: p.team_id }));

  // Re-join each orphan against the live bootstrap payload by fpl_id to
  // recover web_name and its current club — see the OrphanMatchSubject
  // doc comment above for why neither lives on the stored row itself.
  const subjects: OrphanMatchSubject[] = orphans.map((o) => {
    const info = fplByFplId.get(o.fpl_id);
    const teamId = info === undefined ? undefined : teamIdByFplTeamId.get(info.teamFplId);
    return { orphan: o, fullName: info?.name ?? o.name, webName: info?.webName ?? '', teamId };
  });

  const { matches, unmatched: unmatchedOrphans, tierCounts } = matchPlayersTiered(subjects, candidates);
  const matchRate = orphans.length === 0 ? 0 : Math.round((matches.length / orphans.length) * 1000) / 10;
  console.log(
    `repair: ${matches.length}/${orphans.length} orphans matched to an existing football-data row (${matchRate}%) ` +
      `[exact=${tierCounts.exact} last-token=${tierCounts['last-token']} whole-token=${tierCounts['whole-token']}]`,
  );
  if (unmatchedOrphans.length > 0) {
    const sample = unmatchedOrphans.slice(0, 5).map((s) => s.orphan.name);
    console.warn(`repair: ${unmatchedOrphans.length} orphans had no football-data match, e.g. ${sample.join(', ')}`);
  }

  // Merge matched orphans onto their football-data row. Order matters twice
  // over here:
  //   1. Stats must be repointed before the orphan is deleted -- player_
  //      season_stats.player_id is a foreign key `on delete cascade`, so
  //      deleting the orphan first would cascade-delete its own stats
  //      instead of letting them move.
  //   2. The orphan must be deleted *before* the football-data row is given
  //      that fpl_id -- `players.fpl_id` is `unique`, and both rows would
  //      briefly hold the same fpl_id otherwise (the orphan hasn't given it
  //      up yet), which Postgres correctly rejects.
  for (const m of matches) {
    await repointPlayerSeasonStats(m.subject.orphan.id, m.playerId);
  }
  await deletePlayersByIds(matches.map((m) => m.subject.orphan.id));
  await setPlayerFplIdentity(
    matches.map((m) => ({ id: m.playerId, fpl_id: m.subject.orphan.fpl_id, photo_url: m.subject.orphan.photo_url })),
  );

  // Unmatched orphans: at least give them a club, from the live FPL team
  // assignment already resolved onto each subject above.
  const teamAssignments = unmatchedOrphans
    .map((s) => (s.teamId === undefined ? null : { id: s.orphan.id, team_id: s.teamId }))
    .filter((row): row is { id: number; team_id: number } => row !== null);
  await setPlayerTeam(teamAssignments);
  const stillOrphaned = unmatchedOrphans.length - teamAssignments.length;
  if (stillOrphaned > 0) {
    console.warn(`repair: ${stillOrphaned} orphan(s) could not be assigned a team (player left the FPL dataset, or its FPL team didn't match a club)`);
  }

  const message =
    `${orphans.length} orphans, ${matches.length} merged ` +
    `(exact=${tierCounts.exact} last-token=${tierCounts['last-token']} whole-token=${tierCounts['whole-token']}), ` +
    `${teamAssignments.length} re-teamed, ${stillOrphaned} still orphaned`;
  await finishRun(runId, 'ok', message, 0);
  console.log(`repair done: ${message}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('repair failed:', message);
  process.exit(1);
}
