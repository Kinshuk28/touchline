import Image from 'next/image';
import { relativeTime } from '@/lib/site/format';
import type { NewsRow } from '@/lib/site/rows';

type Category = 'transfer' | 'injury';

const CATEGORY_LABEL: Record<Category, string> = { transfer: 'Transfer', injury: 'Injury' };

/**
 * At most one pill per card — a story tagged both transfer and injury
 * (doesn't happen in practice, but the data model allows it) shows transfer,
 * the more common of the two categories. Solid fill, not the old
 * outline-for-injury/fill-for-transfer split, because this pill now sits on
 * top of an arbitrary photo (or the type-only card's surface-2 fill) rather
 * than a flat card background, and needs to hold its own contrast either way.
 */
function categoryOf(item: NewsRow): Category | null {
  if (item.categories.includes('transfer')) return 'transfer';
  if (item.categories.includes('injury')) return 'injury';
  return null;
}

function CategoryPill({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-11 font-bold uppercase tracking-wider ${
        category === 'injury' ? 'bg-live text-white' : 'bg-accent text-accent-ink'
      }`}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/**
 * Two variants sharing one footprint — a 16:9 media block plus the same text
 * block beneath — so a grid mixing image and type-only cards (127 of 198
 * news items have an image; the other 36% do not) never gaps or staggers.
 * The image variant gets `news_items.image_url` at 16:9 with the category
 * pill sitting on the image; the type-only variant fills that same block
 * with `--surface-2` and the pill/source instead of an empty frame.
 */
export function NewsCard({ item, now, lead = false }: { item: NewsRow; now: Date; lead?: boolean }) {
  const age = relativeTime(item.published_at, now);
  const category = categoryOf(item);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-muted"
    >
      {item.image_url ? (
        <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
          <Image
            src={item.image_url}
            alt=""
            fill
            sizes={
              lead
                ? '(min-width: 1024px) 62vw, 100vw'
                : '(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw'
            }
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          {category && (
            <span className="absolute left-2 top-2">
              <CategoryPill category={category} />
            </span>
          )}
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col justify-between bg-surface-2 p-4">
          <div>{category && <CategoryPill category={category} />}</div>
          <span className="font-mono text-11 uppercase tracking-wider text-muted">{item.source}</span>
        </div>
      )}

      <div className="p-3">
        <h3
          className={
            lead
              ? 'font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-32'
              : 'font-display text-18 font-bold leading-snug tracking-[-0.02em]'
          }
        >
          {item.title}
        </h3>
        {lead && item.summary && <p className="mt-2 text-15 text-muted">{item.summary}</p>}
        <p className="mt-2 font-mono text-11 text-muted">
          {item.source}
          {age ? ` · ${age}` : ''}
        </p>
      </div>
    </a>
  );
}
