import 'dotenv/config';
import { serviceClient } from '@/lib/db/client';
import { getAllClubIdentities } from '@/lib/db/repositories/teams';
import { buildTaggingIndex, tagHeadline } from '@/lib/ingest/newsTagging';

/**
 * Backfills `news_items.team_ids` and `news_items.league_id` over rows
 * stored before the news job started tagging (lib/ingest/newsTagging.ts).
 *
 * Both columns have existed since 0001_init.sql with defaults of `'{}'`
 * and null, so every historical row is untagged and invisible to a
 * club-scoped query. This walks them once and applies the same pure
 * function the ingest now applies at write time — identical rules, so a
 * backfilled row and a freshly ingested one are indistinguishable.
 *
 * Idempotent: re-running produces the same tags for the same headline.
 * Safe to run while the news job is running — they touch different rows in
 * practice, and where they overlap they write the same values.
 *
 * `--dry` reports what it would change and writes nothing.
 */

const DRY = process.argv.includes('--dry');
const PAGE = 500;

const clubs = await getAllClubIdentities();
const index = buildTaggingIndex(clubs);
const leagueById = new Map(clubs.map((c) => [c.id, c.league_id]));
const leagueOf = (id: number) => leagueById.get(id) ?? null;

let from = 0;
let scanned = 0;
let changed = 0;
let attributed = 0;

for (;;) {
  const { data, error } = await serviceClient()
    .from('news_items')
    .select('id,title,team_ids,league_id')
    .order('id', { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`backfill-news-tags: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: number; title: string; team_ids: number[] | null; league_id: number | null }>;
  if (rows.length === 0) break;

  for (const row of rows) {
    scanned += 1;
    const tags = tagHeadline(row.title, index, leagueOf);
    const current = [...(row.team_ids ?? [])].sort((a, b) => a - b);
    const same = current.length === tags.team_ids.length
      && current.every((id, i) => id === tags.team_ids[i])
      && (row.league_id ?? null) === tags.league_id;
    // Only write rows whose tags would actually change: an untagged row
    // that still matches nothing is left alone rather than rewritten to
    // the same empty values.
    if (same) continue;
    changed += 1;
    if (tags.team_ids.length > 0) attributed += 1;

    if (!DRY) {
      const { error: updateError } = await serviceClient()
        .from('news_items')
        .update({ team_ids: tags.team_ids, league_id: tags.league_id })
        .eq('id', row.id);
      if (updateError) throw new Error(`backfill-news-tags (id ${row.id}): ${updateError.message}`);
    }
  }

  if (rows.length < PAGE) break;
  from += PAGE;
}

console.log(
  `${DRY ? '[dry run] ' : ''}backfill-news-tags: ${scanned} scanned, ${changed} ${DRY ? 'would change' : 'updated'}, ` +
  `${attributed} now attributed to at least one club`,
);
