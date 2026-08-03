import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { slugify } from '@/lib/db/slug';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { getTeamsByLeagueId } from '@/lib/db/repositories/teams';
import {
  upsertPlayersByFplId,
  getPlayerIdByFplId,
  getFdPlayersByTeamIds,
  setPlayerFplIdentity,
} from '@/lib/db/repositories/players';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { CURRENT_SEASON } from '@/lib/ingest/leagueSeed';
import { matchFplTeamsToClubs } from '@/lib/ingest/playerIdentity';
import { matchPlayersTiered, type MatchSubject } from '@/lib/ingest/playerMatch';
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

  const existingPlayers = await getFdPlayersByTeamIds(clubs.map((c) => c.id));
  const candidates = existingPlayers.map((p) => ({ id: p.id, name: p.name, teamId: p.team_id }));
  const subjects: FplMatchSubject[] = fplPlayers.map((p) => ({
    fplPlayer: p,
    fullName: p.name,
    webName: p.webName,
    teamId: teamIdByFplTeamId.get(p.teamFplId),
  }));
  const { matches, unmatched: unmatchedPlayers, tierCounts } = matchPlayersTiered(subjects, candidates);
  const matchRate = fplPlayers.length === 0 ? 0 : Math.round((matches.length / fplPlayers.length) * 1000) / 10;
  console.log(
    `players: name match ${matches.length}/${fplPlayers.length} (${matchRate}%) ` +
      `[exact=${tierCounts.exact} last-token=${tierCounts['last-token']} whole-token=${tierCounts['whole-token']}]`,
  );
  if (unmatchedPlayers.length > 0) {
    const sample = unmatchedPlayers.slice(0, 5).map((s) => s.fplPlayer.name);
    console.warn(`players: ${unmatchedPlayers.length} unmatched, e.g. ${sample.join(', ')}`);
  }

  // Existing rows: write the FPL identity onto them in place.
  await setPlayerFplIdentity(
    matches.map((m) => ({ id: m.playerId, fpl_id: m.subject.fplPlayer.fplId, photo_url: m.subject.fplPlayer.photoUrl })),
  );

  // Genuine misses: insert as a new row, same shape as before, but resolve
  // team_id from the FPL team mapping instead of always writing null.
  await upsertPlayersByFplId(unmatchedPlayers.map((s) => ({
    fd_id: null, fpl_id: s.fplPlayer.fplId, team_id: s.teamId ?? null,
    slug: `${slugify(s.fplPlayer.name)}-fpl${s.fplPlayer.fplId}`, name: s.fplPlayer.name, position: s.fplPlayer.position,
    nationality: null, date_of_birth: null, photo_url: s.fplPlayer.photoUrl,
  })));

  // Now every FPL player -- matched or newly inserted -- has fpl_id set, so
  // a single id map covers both for writing stats.
  const idByFpl = await getPlayerIdByFplId();
  await upsertPlayerSeasonStats(fplPlayers.flatMap((p) => {
    const playerId = idByFpl.get(p.fplId);
    if (playerId === undefined) return [];
    return [{
      player_id: playerId, league_id: leagueId, season: CURRENT_SEASON, source: 'fpl' as const,
      appearances: null, minutes: p.minutes, goals: p.goals, assists: p.assists,
      expected_goals: p.expectedGoals, yellow_cards: null, red_cards: null, updated_at: now(),
    }];
  }));

  const message = `${fplPlayers.length} players, ${matches.length} matched to existing, ${unmatchedPlayers.length} inserted, teams ${teamIdByFplTeamId.size}/${fplTeams.length}`;
  await finishRun(runId, 'ok', message, 0);
  console.log(`players done: ${message}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('players failed:', message);
  process.exit(1);
}
