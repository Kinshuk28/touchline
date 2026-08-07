import 'dotenv/config';
import { serviceClient } from '@/lib/db/client';

/** Created by 0001_init.sql. Their absence is a broken database. */
const TABLES = [
  'leagues', 'teams', 'players', 'fixtures', 'standings',
  'player_season_stats', 'news_items', 'ingest_run', 'ingest_budget',
];

/**
 * Introduced by later migrations that the project owner applies by hand.
 * Absence here is *not* a failure — it is the expected state between a
 * migration being written and being run — so these are reported separately
 * with the file to apply, rather than exiting non-zero and making the
 * verifier useless for its actual job.
 */
const PENDING: Array<{ name: string; migration: string; effect: string }> = [
  {
    name: 'ingest_run_public',
    migration: '0005_ingest_run_public_view.sql',
    effect: '/status renders without its job-history panel',
  },
  {
    name: 'fantasy_gameweek_points',
    migration: '0006_fantasy_gameweek_points.sql',
    effect: 'scripts/ingest/fantasy.ts cannot run',
  },
  {
    name: 'fantasy_player_season',
    migration: '0007_fantasy_player_season.sql',
    effect: 'the picker has no players to pick from',
  },
  {
    name: 'fantasy_gameweek',
    migration: '0008_fantasy_squads.sql',
    effect: 'the picker cannot name a gameweek or a deadline',
  },
  {
    name: 'fantasy_squad',
    migration: '0008_fantasy_squads.sql',
    effect: 'squads cannot be saved',
  },
  {
    name: 'fantasy_league',
    migration: '0009_fantasy_leagues.sql',
    effect: '/fantasy/leagues says leagues are not set up',
  },
  {
    name: 'fantasy_squad_gameweek',
    migration: '0010_fantasy_transfers.sql',
    effect: 'transfers cannot be counted or charged',
  },
];

const db = serviceClient();
let failed = false;

for (const table of TABLES) {
  const { error } = await db.from(table).select('*').limit(1);
  if (error) {
    console.error(`  MISSING  ${table}  (${error.message})`);
    failed = true;
  } else {
    console.log(`  ok       ${table}`);
  }
}

for (const { name, migration, effect } of PENDING) {
  const { error } = await db.from(name).select('*').limit(1);
  if (error) {
    console.log(`  pending  ${name}  — apply supabase/migrations/${migration}; until then, ${effect}`);
  } else {
    console.log(`  ok       ${name}`);
  }
}

if (failed) {
  console.error('\nSchema incomplete. Re-run supabase/migrations/0001_init.sql in the SQL Editor.');
  process.exit(1);
}
console.log('\nAll core tables present.');
