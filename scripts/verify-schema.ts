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
const PENDING: Array<{ name: string; migration: string; effect: string; column?: string }> = [
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
  {
    // A column, not a table — 0011 only adds one, and selecting `*` would
    // not notice it missing. Probing the column by name is what turns
    // "applied 0010 but not 0011" into a line here rather than a runtime
    // error in the picker.
    name: 'fantasy_squad_gameweek',
    column: 'chip',
    migration: '0011_fantasy_chips.sql',
    effect: 'chips cannot be played',
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

for (const { name, column, migration, effect } of PENDING) {
  const label = column === undefined ? name : `${name}.${column}`;
  const { error } = await db.from(name).select(column ?? '*').limit(1);
  if (error) {
    console.log(`  pending  ${label}  — apply supabase/migrations/${migration}; until then, ${effect}`);
  } else {
    console.log(`  ok       ${label}`);
  }
}

if (failed) {
  console.error('\nSchema incomplete. Re-run supabase/migrations/0001_init.sql in the SQL Editor.');
  process.exit(1);
}
console.log('\nAll core tables present.');
