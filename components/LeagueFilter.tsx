import Link from 'next/link';
import type { LeagueRow } from '@/lib/site/rows';
import { hrefForLeagueFilter } from '@/lib/site/leagueFilter';

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
        className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
          allActive ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:text-text'
        }`}
      >
        All
      </Link>
      {leagues.map((l) => {
        const active = selected.includes(l.fd_code);
        return (
          <Link
            key={l.fd_code}
            href={hrefFor(l.fd_code)}
            aria-current={active ? 'true' : undefined}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              active ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:text-text'
            }`}
          >
            {l.name}
          </Link>
        );
      })}
    </nav>
  );
}
