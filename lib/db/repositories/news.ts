import { serviceClient } from '@/lib/db/client';
import type { NewsItem } from '@/lib/providers/rss';
import { dedupeByKey } from '@/lib/db/dedupe';

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
/**
 * Deduped on `content_hash` (its conflict target) before the upsert — see
 * `lib/db/dedupe.ts`. `ignoreDuplicates: true` (DO NOTHING) doesn't trigger
 * Postgres's "cannot affect row a second time" error the way the other
 * repositories' DO UPDATE upserts do, but a repeated `content_hash` within
 * one batch would still make the returned insert count unreliable, so the
 * same dedupe is applied here for consistency with every other bulk upsert.
 */
type NewsRow = {
  source: string;
  title: string;
  summary: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  categories: string[];
  content_hash: string;
};

/**
 * `published_at` is `not null` until migration `0004_nullable_news_
 * published_at.sql` is applied by hand (the project owner must run it — see
 * that file). Until then, this whole batch upsert fails with a Postgres
 * not-null violation (23502) the moment any item carries
 * `publishedAt: null` (an unusable date, per `lib/providers/rss.ts`'s
 * `safePublishedAt`) — and it fails for *every* item in the batch, not just
 * the null one, because it's one INSERT statement.
 *
 * Rather than let one undated story crash the whole news job, retry once
 * with those items dropped. This makes the code correct in both states of
 * the migration: applied, the first attempt just succeeds and stores
 * `null` as intended; not yet applied, the null-dated items are skipped
 * (logged, not silently lost from view) and every other item still lands.
 */
function isNotNullViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23502' || /null value in column "published_at"/i.test(error.message);
}

export async function upsertNewsItems(items: NewsItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const deduped = dedupeByKey(items, (i) => i.contentHash);
  const rows: NewsRow[] = deduped.map((i) => ({
    source: i.source,
    title: i.title,
    summary: i.summary,
    url: i.url,
    image_url: i.imageUrl,
    published_at: i.publishedAt,
    categories: i.categories,
    content_hash: i.contentHash,
  }));

  const attempt = (r: NewsRow[]) =>
    serviceClient().from('news_items').upsert(r, { onConflict: 'content_hash', ignoreDuplicates: true }).select('id');

  let { data, error } = await attempt(rows);

  if (error && isNotNullViolation(error) && rows.some((r) => r.published_at === null)) {
    const withDate = rows.filter((r) => r.published_at !== null);
    const skipped = rows.length - withDate.length;
    console.warn(
      `upsertNewsItems: news_items.published_at is still NOT NULL (migration 0004 not yet applied) — ` +
      `skipping ${skipped} item(s) with an unusable date instead of fabricating one`,
    );
    ({ data, error } = await attempt(withDate));
  }

  if (error) throw new Error(`upsertNewsItems: ${error.message}`);
  return data?.length ?? 0;
}
