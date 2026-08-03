import 'dotenv/config';
import { serviceClient } from '@/lib/db/client';

const TABLES = [
  'leagues', 'teams', 'players', 'fixtures', 'standings',
  'player_season_stats', 'news_items', 'ingest_run', 'ingest_budget',
];

const db = serviceClient();
let failed = false;

for (const table of TABLES) {
  const { error } = await db.from(table).select('*', { head: true, count: 'exact' });
  if (error) {
    console.error(`  MISSING  ${table}  (${error.message})`);
    failed = true;
  } else {
    console.log(`  ok       ${table}`);
  }
}

if (failed) {
  console.error('\nSchema incomplete. Re-run supabase/migrations/0001_init.sql in the SQL Editor.');
  process.exit(1);
}
console.log('\nAll tables present.');
