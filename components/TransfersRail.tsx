import { getCompetitionMeta } from '@/lib/site/competition';
import { relativeTime } from '@/lib/site/format';
import type { LeagueRow, NewsRow } from '@/lib/site/rows';

/**
 * The dense Transfermarkt-style block the spec calls for: one story per
 * row, a competition colour dot, no images — deliberately contrasting with
 * the image-led news elsewhere. `item.league_id` can be null (not every
 * transfer story resolves to a single top-five club); that renders a muted
 * dot via `getCompetitionMeta('')`'s own fallback rather than inventing a
 * competition, the same rule the rest of the app already follows for a
 * missing club or league.
 *
 * Two layouts, both one story per row:
 *
 * - Default (`/transfers`, full page width): headline and source on one
 *   line, source right-aligned.
 * - `stacked` (the landing dashboard's ~340px middle column): headline on
 *   its own line, source beneath. On one line at that width the source
 *   eats a third of the row and the headline truncates to "Arsenal
 *   complete £..." — the money and the player, which is the entire story,
 *   are what get cut. Two lines cost ~14px per row and keep the sentence.
 */
export function TransfersRail({
  items, leagues, now, chromeless = false, stacked = false,
}: {
  items: NewsRow[];
  leagues: LeagueRow[];
  now: Date;
  /**
   * Drops the rail's own frame for a caller that already draws one around
   * it — the landing dashboard's board panels (components/BoardPanel.tsx).
   * Same reason `MatchdaySpine` takes it: two nested hairline frames read
   * as a mistake.
   */
  chromeless?: boolean;
  /** Headline and source on separate lines — for narrow columns. See above. */
  stacked?: boolean;
}) {
  if (items.length === 0) return null;

  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  return (
    <ul className={chromeless ? '' : 'overflow-hidden rounded-xl border border-border bg-surface'}>
      {items.map((item) => {
        const league = item.league_id !== null ? leagueById.get(item.league_id) : undefined;
        const comp = getCompetitionMeta(league?.fd_code ?? '');
        const age = relativeTime(item.published_at, now);
        const meta = `${item.source}${age ? ` · ${age}` : ''}`;
        return (
          <li
            key={item.id}
            className={`flex gap-2 border-b border-border px-3 last:border-b-0 ${
              stacked ? 'items-start py-1.5' : 'items-center py-2'
            }`}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${comp.bgClass} ${stacked ? 'mt-1.5' : ''}`}
              aria-hidden="true"
            />
            <span className="sr-only">{comp.name}</span>
            {stacked ? (
              <span className="min-w-0 flex-1">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`line-clamp-2 text-13 font-medium leading-snug ${comp.hoverTextClass}`}
                >
                  {item.title}
                </a>
                <span className="mt-0.5 block font-mono text-11 text-muted">{meta}</span>
              </span>
            ) : (
              <>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`min-w-0 flex-1 truncate text-15 font-medium ${comp.hoverTextClass}`}
                >
                  {item.title}
                </a>
                <span className="shrink-0 font-mono text-11 text-muted">{meta}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
