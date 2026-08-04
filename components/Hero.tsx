import Image from 'next/image';
import { relativeTime } from '@/lib/site/format';
import type { NewsRow } from '@/lib/site/rows';

type Category = 'transfer' | 'injury';

const CATEGORY_LABEL: Record<Category, string> = { transfer: 'Transfer', injury: 'Injury' };

// Same rule as NewsCard.tsx's own categoryOf — duplicated rather than
// imported since NewsCard doesn't export it and the logic is a two-line,
// unlikely-to-drift lookup. See that file for the "at most one pill" note.
function categoryOf(item: NewsRow): Category | null {
  if (item.categories.includes('transfer')) return 'transfer';
  if (item.categories.includes('injury')) return 'injury';
  return null;
}

function CategoryPill({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-11 font-bold uppercase tracking-wider ${
        category === 'injury' ? 'bg-live text-live-ink' : 'bg-accent text-accent-ink'
      }`}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/**
 * The landing page's lead story — full-bleed image, headline overlaid on a
 * bottom-anchored scrim, category pill on the image itself. Replaces the old
 * two-column hero row (a lead `NewsCard` beside a live-scores panel) that
 * left ~180px of dead space when the panel was short.
 *
 * The scrim block behind the headline is a *flat* `bg-scrim`, not a
 * gradient fading toward the text — a gradient's alpha right at the text
 * baseline is hard to guarantee, whereas a flat block reproduces exactly the
 * "scrim over a pure-white pixel" worst case the foundation pass measured at
 * 13.29:1 for white text (see this task's report for the independently
 * re-verified figure). A separate, purely decorative gradient sits above it
 * for visual richness without carrying any contrast obligation.
 *
 * Text in the overlay is `text-white`, not the theme's `--text` token: the
 * dark-theme `--text` value is near-white already, but light-theme `--text`
 * is near-black and would sit on the scrim at ~1.3:1. Overlay text must stay
 * light regardless of site theme, since the image behind it is arbitrary.
 */
export function Hero({ item, now }: { item: NewsRow; now: Date }) {
  const category = categoryOf(item);
  const age = relativeTime(item.published_at, now);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-2xl border border-border"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-surface-2 sm:aspect-[21/9]">
        {item.image_url ? (
          <>
            <Image
              src={item.image_url}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            <div
              className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent"
              aria-hidden="true"
            />
            {category && (
              <span className="absolute left-3 top-3 sm:left-4 sm:top-4">
                <CategoryPill category={category} />
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-scrim px-4 py-4 sm:px-8 sm:py-6">
              <h1 className="font-display text-24 font-extrabold leading-tight tracking-[-0.02em] text-white sm:text-44">
                {item.title}
              </h1>
              <p className="mt-2 font-mono text-11 uppercase tracking-wider text-white">
                {item.source}
                {age ? ` · ${age}` : ''}
              </p>
            </div>
          </>
        ) : (
          // Type-only fallback — the spec is explicit that a lead item with
          // no image gets this, never an empty frame or placeholder graphic.
          <div className="flex h-full w-full flex-col justify-between p-4 sm:p-8">
            <div>{category && <CategoryPill category={category} />}</div>
            <div>
              <h1 className="font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-44">
                {item.title}
              </h1>
              <p className="mt-2 font-mono text-11 uppercase tracking-wider text-muted">
                {item.source}
                {age ? ` · ${age}` : ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </a>
  );
}
