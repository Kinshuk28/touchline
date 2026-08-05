import { getCompetitionMeta } from '@/lib/site/competition';
import { relativeTime } from '@/lib/site/format';
import type { LeagueRow } from '@/lib/site/rows';
import type { TransferNewsRow } from '@/lib/site/queries/news';

/**
 * The dense Transfermarkt-style block the spec calls for: one line per
 * story, a competition colour dot, no images — deliberately contrasting
 * with the image-led news grid above it. `item.league_id` can be null (not
 * every transfer story resolves to a single top-five club); that renders a
 * muted dot via `getCompetitionMeta('')`'s own fallback rather than
 * inventing a competition, the same rule the rest of the app already
 * follows for a missing club or league.
 */
export function TransfersRail({
  items, leagues, now,
}: { items: TransferNewsRow[]; leagues: LeagueRow[]; now: Date }) {
  if (items.length === 0) return null;

  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((item) => {
        const league = item.league_id !== null ? leagueById.get(item.league_id) : undefined;
        const comp = getCompetitionMeta(league?.fd_code ?? '');
        const age = relativeTime(item.published_at, now);
        return (
          <li key={item.id} className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
            <span className={`size-2 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
            <span className="sr-only">{comp.name}</span>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`min-w-0 flex-1 truncate text-15 font-medium ${comp.hoverTextClass}`}
            >
              {item.title}
            </a>
            <span className="shrink-0 font-mono text-11 text-muted">
              {item.source}
              {age ? ` · ${age}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
