import Image from 'next/image';
import { relativeTime } from '@/lib/site/format';
import { upgradeImageUrl } from '@/lib/site/imageUrl';
import type { NewsRow } from '@/lib/site/rows';

// A regular card renders at roughly a quarter of the viewport width at
// desktop (~480px at 1920), so 1024 clears 2x-DPI sharpness with real
// headroom rather than sitting right at the edge of it — see
// lib/site/imageUrl.ts for the measured BBC ichef renditions this maps to
// (240/480/800/1024/1536, all verified non-error).
const CARD_IMAGE_WIDTH = 1024;
// The lead card (the first story on /news — see app/news/page.tsx) spans
// roughly half the grid at desktop, well over double a regular card's
// footprint, so it earns the largest verified rendition rather than
// reusing the regular card's.
const LEAD_IMAGE_WIDTH = 1536;

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
        // `text-live-ink`, not a hardcoded `text-white` — solid white on
        // dark-theme `--live` (#FF4438) measures 3.42:1, below the 4.5:1
        // floor for text this small, since --live is a bright red in dark
        // theme but a darker one in light theme. `--live-ink` is turf in
        // dark theme, white in light theme, both independently verified
        // >=4.9:1. The non-injury case has no house accent to fall back
        // on post-Direction-Two — `bg-text text-bg` is plain chalk
        // emphasis, inverted from the page's own colours per theme.
        category === 'injury' ? 'bg-live text-live-ink' : 'bg-text text-bg'
      }`}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/**
 * Two variants at the same overall footprint — an image card (16:9 media
 * block plus a text block beneath) and a type-only card — so a grid mixing
 * the two (127 of 198 news items have an image; the other 36% do not) never
 * gaps or staggers. The image variant gets `news_items.image_url` at 16:9
 * with the category pill sitting on the image.
 *
 * The type-only variant is deliberately *not* the image block's frame with
 * an empty middle: that read as a failed image load, the exact impression
 * the fallback exists to avoid. Instead the headline itself becomes
 * the card's dominant element, set larger than the image variant's
 * headline since it has the whole card to fill rather than sharing it with
 * a photo. `h-full` (the `<a>` is a CSS grid item, stretched to its row's
 * height by the grid's default `align-items: stretch`, which is what makes
 * a percentage height on this child resolve to something real) plus a
 * `min-h` floor means it fills whatever height its image-bearing siblings
 * establish, or a sane minimum when a whole row is type-only cards, rather
 * than stopping short and leaving a blank strip of `bg-surface` underneath.
 */
export function NewsCard({
  item, now, lead = false, className = '',
}: { item: NewsRow; now: Date; lead?: boolean; className?: string }) {
  const age = relativeTime(item.published_at, now);
  const category = categoryOf(item);
  const sourceLine = `${item.source}${age ? ` · ${age}` : ''}`;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block h-full overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-muted ${className}`}
    >
      {item.image_url ? (
        <>
          <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
            <Image
              src={upgradeImageUrl(item.image_url, lead ? LEAD_IMAGE_WIDTH : CARD_IMAGE_WIDTH)}
              alt=""
              fill
              // Matches the grid slot a lead card actually occupies
              // (`sm:col-span-2` on a `grid-cols-1 sm:grid-cols-2
              // lg:grid-cols-4` grid — see app/news/page.tsx): half the row
              // from `lg:` up, the full row below it, never the stale 62vw
              // guess this used to carry with nothing in the actual layout
              // to back that number.
              sizes={
                lead
                  ? '(min-width: 1024px) 50vw, 100vw'
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
            <p className="mt-2 font-mono text-11 text-muted">{sourceLine}</p>
          </div>
        </>
      ) : (
        <div className="flex h-full min-h-[230px] flex-col justify-between gap-4 bg-surface-2 p-4">
          <div>{category && <CategoryPill category={category} />}</div>
          <div>
            <h3
              className={
                lead
                  ? 'font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-44'
                  : 'font-display text-24 font-extrabold leading-tight tracking-[-0.02em]'
              }
            >
              {item.title}
            </h3>
            <p className="mt-2 font-mono text-11 uppercase tracking-wider text-muted">{sourceLine}</p>
          </div>
        </div>
      )}
    </a>
  );
}
