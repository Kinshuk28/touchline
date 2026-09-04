import { serviceClient } from '@/lib/db/client';

export interface FixtureGoalRow {
  fixture_id: number;
  team_id: number | null;
  minute: number | null;
  scorer_name: string;
  assist_name: string | null;
  type: string | null;
  updated_at: string;
}

/**
 * Replaces every goal row for one fixture with the current set, rather than
 * upserting — football-data.org's goal objects carry no stable per-goal id
 * to conflict on (see supabase/migrations/0014_fixture_goals.sql). Safe to
 * call with an empty `rows`: the fixture's goals are simply cleared, which
 * is correct if the provider ever stops returning them for a match that
 * previously had some (e.g. a corrected match record).
 */
export async function replaceFixtureGoals(fixtureId: number, rows: FixtureGoalRow[]): Promise<void> {
  const db = serviceClient();
  const { error: delErr } = await db.from('fixture_goals').delete().eq('fixture_id', fixtureId);
  if (delErr) throw new Error(`replaceFixtureGoals: ${delErr.message}`);
  if (rows.length === 0) return;
  const { error } = await db.from('fixture_goals').insert(rows);
  if (error) throw new Error(`replaceFixtureGoals: ${error.message}`);
}
