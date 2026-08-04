import { readClient } from '@/lib/site/supabase';
import type { NewsRow } from '@/lib/site/rows';

/**
 * Newest first, but rows with a null published_at sort last rather than
 * first — an article of unknown date must not pin itself to the top.
 */
export async function getTrendingNews(limit = 8): Promise<NewsRow[]> {
  const { data, error } = await readClient()
    .from('news_items')
    .select('id,source,title,summary,url,image_url,published_at,categories')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getTrendingNews: ${error.message}`);
  return (data ?? []) as NewsRow[];
}

/**
 * A `NewsRow` plus `league_id` — only `getTransferNews` selects this column.
 * `NewsRow` itself stays as every other query already shaped it (no
 * `league_id`) rather than widening the shared type for one caller's colour
 * dot.
 */
export interface TransferNewsRow extends NewsRow {
  league_id: number | null;
}

/**
 * Transfer-tagged stories, newest first — the redesign spec's "Transfers
 * rail" (one line per story, competition colour dot, no images). Selects
 * `league_id` (unlike `getTrendingNews`) so the rail can resolve a colour via
 * `lib/site/competition.ts`; a null `league_id` — a real possibility, not
 * every transfer story is tied to a single top-five club — renders with no
 * invented competition, same "never invent data" rule as everywhere else in
 * this app.
 */
export async function getTransferNews(limit = 10): Promise<TransferNewsRow[]> {
  const { data, error } = await readClient()
    .from('news_items')
    .select('id,source,title,summary,url,image_url,published_at,categories,league_id')
    .contains('categories', ['transfer'])
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getTransferNews: ${error.message}`);
  return (data ?? []) as TransferNewsRow[];
}
