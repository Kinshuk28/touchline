import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { slugify } from '@/lib/db/slug';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamsByLeagueId } from '@/lib/db/repositories/teams';
import {
  upsertPlayersByFplId,
  getPlayerIdByFplId,
  getFdPlayersByTeamIds,
  getOrphanFplPlayers,
} from '@/lib/db/repositories/players';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { matchFplTeamsToClubs } from '@/lib/ingest/playerIdentity';
import { matchPlayersTiered, type MatchSubject } from '@/lib/ingest/playerMatch';
import { planFplIdentityAssignment, applyFplIdentityPlans, type OrphanRef } from '@/lib/ingest/fplIdentityMerge';
import type { FplPlayer } from '@/lib/providers/fpl';

/**
 * Premier League players exist because of two independent write paths --
 * football-data.org (`fd_id`, full squad + team) and FPL (`fpl_id`, deep
 * stats + photo) -- and nothing reconciled them until this fix. This job
 * therefore resolves FPL identity onto *existing* football-data rows rather
 * than inserting a parallel row for every FPL element:
 *
 *   1. Match FPL's 20 clubs onto our stored Premier League `teams` rows
 *      (`matchFplTeamsToClubs`), so a brand-new FPL-only player still gets a
 *      real `team_id` instead of being orphaned.
 *   2. Match each FPL player onto an existing football-data player, scoped
 *      to its club, via the tiered exact/last-token/whole-token matcher
 *      (`matchPlayersTiered` in `lib/ingest/playerMatch.ts`) -- a plain
 *      normalised-full-name join under-matches badly here because FPL's
 *      name is the full legal name while football-data stores the display
 *      name ("David Raya Martín" vs "David Raya"). A match updates that
 *      row's `fpl_id`/`photo_url` in place -- `fd_id`, `team_id` and `slug`
 *      are left untouched. A miss inserts a new row, same as before, but
 *      now with `team_id` set from step 1 instead of always `null`.
 *
 * See `lib/ingest/playerIdentity.ts` for why the team match uses more than a
 * literal name comparison, and `lib/ingest/playerMatch.ts` for the tiered
 * player match. The match rate for both steps is never perfect -- reported
 * here, per tier, not silently swallowed.
 *
 * This job runs on a schedule and must be idempotent against the state its
 * own earlier runs (and the one-shot repair, `scripts/repair/
 * mergeFplPlayers.ts`) left behind. `players.fpl_id` is unique, so a subject
 * whose fpl_id already sits on some row -- fully merged, or still an orphan
 * (fd_id null) -- needs care: an already-merged subject is excluded from
 * matching entirely (its target row no longer offers itself as a fd
 * candidate below, so re-running it through the matcher would only produce
 * a false "unmatched" that must never be inserted as if new), and a matched
 * subject whose fpl_id sits on a *different*, orphan row is merged onto the
 * new target rather than crashing on the unique-constraint collision. See
 * `lib/ingest/fplIdentityMerge.ts` for the shared decision logic (also used
 * by the repair script, so this exists in exactly one place).
 */
type FplMatchSubject = MatchSubject & { fplPlayer: FplPlayer };
const runId = await startRun('players');
const now = () => new Date().toISOString();

try {
  const leagueId = (await getLeagueIdMap()).get('PL');
  if (leagueId === undefined) throw new Error('Premier League missing — run backfill first');

  const { players: fplPlayers, teams: fplTeams } = await new FplClient().getBootstrap();
  const clubRows = await getTeamsByLeagueId(leagueId);
  const clubs = clubRows.map((c) => ({ id: c.id, name: c.name, shortName: c.short_name, tla: c.tla }));

  const { teamIdByFplTeamId, unmatched: unmatchedTeams } = matchFplTeamsToClubs(fplTeams, clubs);
  console.log(`players: FPL team match ${teamIdByFplTeamId.size}/${fplTeams.length}`);
  if (unmatchedTeams.length > 0) {
    console.warn(`players: unmatched FPL teams: ${unmatchedTeams.map((t) => t.name).join(', ')}`);
  }

  // What already holds each fpl_id, from an earlier run of this job or the
  // one-shot repair -- either a fully-merged football-data row, or an
  // orphan (fd_id null). A fully-merged subject's target row no longer
  // appears in the fd candidate pool below (it already has fpl_id set), so
  // it must be excluded from matching altogether: left in, the matcher
  // would report it "unmatched" every run and `upsertPlayersByFplId` would
  // then overwrite that row's real fd_id/nationality/date_of_birth with
  // FPL-only nulls via its onConflict('fpl_id') update. An orphan-linked
  // subject, by contrast, must keep being matched every run -- that's how
  // an orphan eventually finds its football-data row (and is exactly the
  // case that used to crash `setPlayerFplIdentity` on a duplicate key).
  const idByFpl = await getPlayerIdByFplId();
  const orphans = await getOrphanFplPlayers();
  const orphanByFplId = new Map<number, OrphanRef>(orphans.map((o) => [o.fpl_id, o]));
  const alreadyMergedFplIds = new Set([...idByFpl.keys()].filter((fplId) => !orphanByFplId.has(fplId)));

  const existingPlayers = await getFdPlayersByTeamIds(clubs.map((c) => c.id));
  const candidates = existingPlayers.map((p) => ({ id: p.id, name: p.name, teamId: p.team_id }));
  const toMatch = fplPlayers.filter((p) => !alreadyMergedFplIds.has(p.fplId));
  const subjects: FplMatchSubject[] = toMatch.map((p) => ({
    fplPlayer: p,
    fullName: p.name,
    webName: p.webName,
    teamId: teamIdByFplTeamId.get(p.teamFplId),
  }));
  const { matches, unmatched: unmatchedPlayers, tierCounts } = matchPlayersTiered(subjects, candidates);
  const matchRate = subjects.length === 0 ? 0 : Math.round((matches.length / subjects.length) * 1000) / 10;
  console.log(
    `players: ${fplPlayers.length} FPL players, ${alreadyMergedFplIds.size} already linked; ` +
      `name match ${matches.length}/${subjects.length} of the remainder (${matchRate}%) ` +
      `[exact=${tierCounts.exact} last-token=${tierCounts['last-token']} whole-token=${tierCounts['whole-token']}]`,
  );
  if (unmatchedPlayers.length > 0) {
    const sample = unmatchedPlayers.slice(0, 5).map((s) => s.fplPlayer.name);
    console.warn(`players: ${unmatchedPlayers.length} unmatched, e.g. ${sample.join(', ')}`);
  }

  // Existing rows: write the FPL identity onto them in place -- merging an
  // orphan out of the way first if one already holds this fpl_id, skipping
  // (never guessing) if that's not safe. See lib/ingest/fplIdentityMerge.ts.
  const plans = matches.map((m) => {
    const fplId = m.subject.fplPlayer.fplId;
    const ownerId = idByFpl.get(fplId);
    const currentOwner = ownerId === undefined ? undefined : { id: ownerId, orphan: orphanByFplId.get(fplId) };
    return planFplIdentityAssignment(
      { targetPlayerId: m.playerId, fplId, photoUrl: m.subject.fplPlayer.photoUrl },
      currentOwner,
    );
  });
  const { merged, skipped } = await applyFplIdentityPlans(plans, (msg) => console.warn(msg));

  // Genuine misses: insert as a new row, same shape as before, but resolve
  // team_id from the FPL team mapping instead of always writing null. Safe
  // to run twice -- `unmatchedPlayers` here can only be a subject with no
  // fpl_id anywhere yet, or a still-standalone orphan (fully-merged subjects
  // were excluded from `toMatch` above), so `upsertPlayersByFplId`'s
  // onConflict('fpl_id') never clobbers a real football-data row.
  await upsertPlayersByFplId(unmatchedPlayers.map((s) => ({
    fd_id: null, fpl_id: s.fplPlayer.fplId, team_id: s.teamId ?? null,
    slug: `${slugify(s.fplPlayer.name)}-fpl${s.fplPlayer.fplId}`, name: s.fplPlayer.name, position: s.fplPlayer.position,
    nationality: null, date_of_birth: null, photo_url: s.fplPlayer.photoUrl,
  })));

  // Now every FPL player -- already linked, matched, merged, or newly
  // inserted -- has fpl_id set, so a single id map covers all of them for
  // writing stats. Refetched, since the plans/insert above just changed it.
  const idByFplAfter = await getPlayerIdByFplId();
  await upsertPlayerSeasonStats(fplPlayers.flatMap((p) => {
    const playerId = idByFplAfter.get(p.fplId);
    if (playerId === undefined) return [];
    return [{
      player_id: playerId, league_id: leagueId, season: CURRENT_SEASON, source: 'fpl' as const,
      appearances: null, minutes: p.minutes, goals: p.goals, assists: p.assists,
      expected_goals: p.expectedGoals, yellow_cards: null, red_cards: null, updated_at: now(),
    }];
  }));

  const message =
    `${fplPlayers.length} FPL players, ${alreadyMergedFplIds.size} already linked, ${matches.length} matched ` +
    `(${merged} merged from orphan, ${skipped} skipped), ${unmatchedPlayers.length} inserted/updated, ` +
    `teams ${teamIdByFplTeamId.size}/${fplTeams.length}`;
  await finishRun(runId, 'ok', message, 0);
  console.log(`players done: ${message}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('players failed:', message);
  process.exit(1);
}
