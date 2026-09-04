import { readClient } from '@/lib/site/supabase';
import { isMissingTable } from '@/lib/site/queries/fantasy';

export interface FixtureGoal {
  id: number;
  team_id: number | null;
  minute: number | null;
  scorer_name: string;
  assist_name: string | null;
  type: string | null;
}

const GOAL_FIELDS = 'id,team_id,minute,scorer_name,assist_name,type';

/**
 * Written by scripts/ingest/matchDetails.ts when a fixture has been checked
 * and found to have nothing to show (a real 0-0, or the provider had no
 * detail available) — never a real scorer name. Filtered out here so it
 * never reaches a page; its only job is telling that ingest script not to
 * re-check the same fixture forever.
 */
const CHECKED_SENTINEL = '__checked_no_goals__';

/**
 * Every goal on file for one fixture, ordered by minute — `[]` both for a
 * fixture with no detail on file yet (never ingested, or the provider
 * simply had none to give) and for `fixture_goals` not existing at all yet
 * (supabase/migrations/0014_fixture_goals.sql not applied). The match
 * detail page's goals section renders nothing rather than an error either
 * way — same "unapplied migration reads as empty, not broken" contract
 * `lib/site/queries/fantasy.ts#isMissingTable` already established for
 * `/fantasy`.
 */
export async function getGoalsForFixture(fixtureId: number): Promise<FixtureGoal[]> {
  const { data, error } = await readClient()
    .from('fixture_goals')
    .select(GOAL_FIELDS)
    .eq('fixture_id', fixtureId)
    .neq('scorer_name', CHECKED_SENTINEL)
    .order('minute', { ascending: true, nullsFirst: false });
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new Error(`getGoalsForFixture: ${error.message}`);
  }
  return (data ?? []) as unknown as FixtureGoal[];
}
