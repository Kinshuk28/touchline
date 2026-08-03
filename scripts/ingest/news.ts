import 'dotenv/config';
import { RssClient } from '@/lib/providers/rss';
import { upsertNewsItems } from '@/lib/db/repositories/news';
import { startRun, finishRun } from '@/lib/db/repositories/runs';

const runId = await startRun('news');

try {
  const items = await new RssClient().fetchAll();
  const inserted = await upsertNewsItems(items);
  await finishRun(runId, 'ok', `${items.length} fetched, ${inserted} new`, 0);
  console.log(`news done: ${items.length} fetched, ${inserted} new`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await finishRun(runId, 'error', message, 0);
  console.error('news failed:', message);
  process.exit(1);
}
