import 'dotenv/config';
import { RssClient } from '@/lib/providers/rss';
import { upsertNewsItems } from '@/lib/db/repositories/news';
import { getAllClubIdentities } from '@/lib/db/repositories/teams';
import { tagHeadlines } from '@/lib/ingest/newsTagging';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const runId = await startRun('news');

try {
  // Clubs are read once per run and the index built once for the whole
  // batch — 110 short strings against ~150 headlines is trivial work, and
  // doing it here rather than at render time is the entire point: a tagged
  // row can be queried by club, a render-time match cannot.
  const [items, clubs] = await Promise.all([new RssClient().fetchAll(), getAllClubIdentities()]);
  const tagged = tagHeadlines(items, clubs).map(({ team_ids, league_id, ...item }) => ({
    ...item,
    teamIds: team_ids,
    leagueId: league_id,
  }));
  const attributed = tagged.filter((i) => i.teamIds.length > 0).length;
  const inserted = await upsertNewsItems(tagged);
  await finishRun(runId, 'ok', `${items.length} fetched, ${inserted} new, ${attributed} tagged`, 0);
  console.log(`news done: ${items.length} fetched, ${inserted} new, ${attributed} tagged to clubs`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('news failed:', message);
  process.exit(1);
}
