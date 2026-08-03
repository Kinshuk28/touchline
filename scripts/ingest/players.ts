import 'dotenv/config';
import { FplClient } from '@/lib/providers/fpl';
import { slugify } from '@/lib/db/slug';
import { getLeagueIdMap } from '@/lib/db/repositories/leagues';
import { upsertPlayersByFplId, getPlayerIdByFplId } from '@/lib/db/repositories/players';
import { upsertPlayerSeasonStats } from '@/lib/db/repositories/playerStats';
import { startRun, finishRun } from '@/lib/db/repositories/runs';
import { CURRENT_SEASON } from '@/lib/ingest/leagueSeed';

const runId = await startRun('players');
const now = () => new Date().toISOString();

try {
  const players = await new FplClient().getPlayers();
  const leagueId = (await getLeagueIdMap()).get('PL');
  if (leagueId === undefined) throw new Error('Premier League missing — run backfill first');

  await upsertPlayersByFplId(players.map((p) => ({
    fd_id: null, fpl_id: p.fplId, team_id: null,
    slug: `${slugify(p.name)}-fpl${p.fplId}`, name: p.name, position: p.position,
    nationality: null, date_of_birth: null, photo_url: p.photoUrl,
  })));

  const idByFpl = await getPlayerIdByFplId();
  await upsertPlayerSeasonStats(players.flatMap((p) => {
    const playerId = idByFpl.get(p.fplId);
    if (playerId === undefined) return [];
    return [{
      player_id: playerId, league_id: leagueId, season: CURRENT_SEASON, source: 'fpl' as const,
      appearances: null, minutes: p.minutes, goals: p.goals, assists: p.assists,
      expected_goals: p.expectedGoals, yellow_cards: null, red_cards: null, updated_at: now(),
    }];
  }));

  await finishRun(runId, 'ok', `${players.length} players`, 0);
  console.log(`players done: ${players.length}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('players failed:', message);
  process.exit(1);
}
