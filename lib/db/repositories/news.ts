import { serviceClient } from '@/lib/db/client';
import type { NewsItem } from '@/lib/providers/rss';

/**
 * Inserts or updates news items by content_hash, returning the count of newly
 * inserted rows only (duplicates are ignored and not counted).
 *
 * WARNING: PostgREST caps a plain `select` at 1,000 rows by default. This call
 * does `.select('id')` without pagination. If a single batch ever exceeds 1,000
 * items, the returned count will under-report true insertions.
 *
 * Current safety: RSS feeds batch ~150 items in practice. If batch sizes grow
 * beyond ~800 items, add pagination to this function: split the upsert into
 * sub-batches (e.g. 500 items per batch, like `upsertFixtures` and
 * `upsertPlayerSeasonStats`), then sum the returned counts.
 */
export async function upsertNewsItems(items: NewsItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((i) => ({
    source: i.source,
    title: i.title,
    summary: i.summary,
    url: i.url,
    image_url: i.imageUrl,
    published_at: i.publishedAt,
    categories: i.categories,
    content_hash: i.contentHash,
  }));
  const { data, error } = await serviceClient()
    .from('news_items')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`upsertNewsItems: ${error.message}`);
  return data?.length ?? 0;
}
