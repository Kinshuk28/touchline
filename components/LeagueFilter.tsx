import Link from 'next/link';
import { getCompetitionMeta } from '@/lib/site/competition';
import type { LeagueRow } from '@/lib/site/rows';
import { hrefForLeagueFilter } from '@/lib/site/leagueFilter';

/**
 * Direction Two deletes the single lime accent, so "active" here can no
 * longer be one house colour. "All" spans every competition, so its active
 * state is plain chalk emphasis (full-strength `--text`/`--border`, not a
 * fill — no competition owns it). Each league pill's active state is that
 * league's own competition colour instead, via `getCompetitionMeta` — an
 * outline (border + text), not a solid fill, so it only ever needs to clear
 * AA as text against `--surface-2`, not solve a fill+ink pair per colour.
 */
export function LeagueFilter({
  leagues, selected, basePath,
}: { leagues: LeagueRow[]; selected: string[]; basePath: string }) {
  const hrefFor = (code: string | null) => hrefForLeagueFilter(basePath, selected, code);

  const allActive = selected.length === 0;

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Filter by competition">
      <Link
        href={hrefFor(null)}
        aria-current={allActive ? 'true' : undefined}
        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
          allActive ? 'border-text bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
        }`}
      >
        All
      </Link>
      {leagues.map((l) => {
        const active = selected.includes(l.fd_code);
        const comp = getCompetitionMeta(l.fd_code);
        return (
          <Link
            key={l.fd_code}
            href={hrefFor(l.fd_code)}
            aria-current={active ? 'true' : undefined}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
              active
                ? `bg-surface-2 ${comp.borderClass} ${comp.textClass}`
                : 'border-border text-muted hover:text-text'
            }`}
          >
            {l.name}
          </Link>
        );
      })}
    </nav>
  );
}
