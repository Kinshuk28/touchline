import Image from 'next/image';
import { relativeTime } from '@/lib/site/format';
import { upgradeImageUrl } from '@/lib/site/imageUrl';
import type { NewsRow } from '@/lib/site/rows';

// The rail's thumbnail is a fixed 56px square in a ~300px column, so it is
// never rendered above ~112 device pixels even at 2x. 240 is the smallest
// rendition BBC's ichef CDN serves (lib/site/imageUrl.ts) and is already
// more than enough — asking for the card's 800 here would download ~8x the
// bytes for the same 56 painted pixels.
const RAIL_IMAGE_WIDTH = 240;

/**
 * The dense news rail — the landing dashboard's narrowest column
 * (docs/superpowers/specs/2026-08-04-landing-dashboard-handoff.md: "a new
 * compact news rail — `NewsCard` is too large for this"). One line-and-a-bit
 * per story: headline, source, age, and a small square thumbnail where one
 * exists.
 *
 * `NewsCard` is still what /news uses; it is a 16:9 image card ~230px tall,
 * so eight of them is 1800px of column and the dashboard's whole point is
 * that eight fit in a screen. This is that same information at roughly a
 * fifth of the height.
 *
 * A missing image (36% of stored items — the Guardian supplies none at all)
 * simply lets the text run the full width. No placeholder box, no
 * monogram: an empty 56px square on a third of the rows reads as a grid of
 * failed loads, and this app never renders invented imagery.
 */
export function NewsRail({ items, now }: { items: NewsRow[]; now: Date }) {
  if (items.length === 0) {
    return <p className="px-3 py-4 text-13 text-muted">No headlines yet — the news job runs every 15 minutes.</p>;
  }

  return (
    <ul>
      {items.map((item) => {
        const age = relativeTime(item.published_at, now);
        return (
          <li key={item.id} className="border-b border-border last:border-b-0">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 px-3 py-2 hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                {/* Two lines max, then ellipsis: a rail of eight items has
                    to stay predictable in height, and a four-line headline
                    would push the ones below it off the board. */}
                <span className="line-clamp-2 text-13 font-medium leading-snug">{item.title}</span>
                <span className="mt-0.5 block font-mono text-11 text-muted">
                  {item.source}
                  {age ? ` · ${age}` : ''}
                </span>
              </span>
              {item.image_url && (
                <span className="relative size-14 shrink-0 overflow-hidden rounded bg-surface-2">
                  <Image
                    src={upgradeImageUrl(item.image_url, RAIL_IMAGE_WIDTH)}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
