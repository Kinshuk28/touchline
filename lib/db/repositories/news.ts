import { serviceClient } from '@/lib/db/client';
import type { NewsItem } from '@/lib/providers/rss';

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
