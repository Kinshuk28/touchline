import { readClient } from '@/lib/site/supabase';
import type { NewsRow } from '@/lib/site/rows';

const NEWS_COLUMNS = 'id,source,title,summary,url,image_url,published_at,categories,league_id';

/**
 * Newest first, but rows with a null published_at sort last rather than
 * first — an article of unknown date must not pin itself to the top.
 *
 * `leagueIds`, when given, narrows at the query itself rather than filtering
 * an already-fetched, already-`limit`-capped page of results — the same
 * shape `getUpcoming`/`getLiveAndRecent` (lib/site/queries/fixtures.ts) use.
 * Filtering the fetched page in JS instead would silently under-report a
 * league whose stories simply aren't among the newest `limit` overall: a
 * reader who narrows to Ligue 1 needs the newest *Ligue 1* stories, not
 * whichever of them happened to survive a global recency cut first. An
 * empty `leagueIds` array (every option deselected) means "match nothing",
 * the same convention those two functions use, not "no filter".
 */
export async function getTrendingNews(limit = 8, leagueIds?: number[]): Promise<NewsRow[]> {
  if (leagueIds && leagueIds.length === 0) return [];

  let q = readClient()
    .from('news_items')
    .select(NEWS_COLUMNS)
    .order('published_at', { ascending: false, nullsFirst: false });
  if (leagueIds && leagueIds.length > 0) q = q.in('league_id', leagueIds);
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw new Error(`getTrendingNews: ${error.message}`);
  return (data ?? []) as NewsRow[];
}

/**
 * One club's news, from the stored tags rather than a render-time match.
 *
 * `news_items.team_ids` is written by the news job
 * (lib/ingest/newsTagging.ts) and backfilled over historical rows by
 * `scripts/repair/backfill-news-tags.ts`. Querying it means a club page
 * gets that club's stories however far back they sit, in one indexed
 * query — where matching headlines at render time could only ever search
 * whatever page of recent news the page had already fetched.
 *
 * Returns an empty array, not an error, for a club with no tagged stories.
 * The caller decides what that means: while the backfill has not yet run,
 * app/team/[slug] falls back to matching the headline itself, so the page
 * degrades to its previous behaviour rather than to a blank panel.
 */
export async function getNewsForTeam(teamId: number, limit = 8): Promise<NewsRow[]> {
  const { data, error } = await readClient()
    .from('news_items')
    .select(NEWS_COLUMNS)
    .contains('team_ids', [teamId])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getNewsForTeam: ${error.message}`);
  return (data ?? []) as NewsRow[];
}
