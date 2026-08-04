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
