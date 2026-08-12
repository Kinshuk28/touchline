import Link from 'next/link';
import { getCompetitionMeta } from '@/lib/site/competition';
import type { LeagueRow } from '@/lib/site/rows';

/**
 * A single-select competition tab bar — pick one league (or, when `showAll`
 * is set, "All") and see just that. Extracted from the landing dashboard's
 * own `?table=` tabs (originally a local, unexported `TableTabs` in
 * `app/page.tsx`), which solved exactly this problem for its one "Table"
 * board panel but was never reused anywhere a full page had the same
 * "five leagues' worth of content, stacked, no way to see just one" shape —
 * `/tables` (five full standings tables back to back) and `/clubs` (110
 * cards across five sections plus a historical group) both had it.
 *
 * Deliberately just the tab bar, not the filtering logic: `hrefFor` is the
 * caller's own, so each page keeps whatever other query params it carries
 * (`/tables`' `?season=`, for instance) without this component needing to
 * know they exist.
 *
 * Labels are the competition codes, not full names — five full league names
 * do not fit across a narrow column or a 360px screen without wrapping to a
 * second line, and the code is text (not colour) so nothing here depends on
 * the dot alone; the selected league's full name belongs in a line the
 * caller renders next to this, and every tab still carries its full name
 * for assistive tech.
 */
export function CompetitionTabs({
  leagues, selected, hrefFor, showAll = false, ariaLabel,
}: {
  leagues: LeagueRow[];
  /** `null` means the "All" tab is active — only meaningful when `showAll` is true. */
  selected: LeagueRow | null;
  hrefFor: (league: LeagueRow | null) => string;
  showAll?: boolean;
  ariaLabel: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5" aria-label={ariaLabel}>
      {showAll && (
        <Link
          href={hrefFor(null)}
          aria-current={selected === null ? 'true' : undefined}
          className={`rounded px-1.5 py-1 font-mono text-11 font-semibold uppercase tracking-wider ${
            selected === null ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
          }`}
        >
          All
        </Link>
      )}
      {leagues.map((league) => {
        const comp = getCompetitionMeta(league.fd_code);
        const active = selected?.id === league.id;
        return (
          <Link
            key={league.id}
            href={hrefFor(league)}
            aria-current={active ? 'true' : undefined}
            className={`flex items-center gap-1 rounded px-1.5 py-1 font-mono text-11 font-semibold uppercase tracking-wider ${
              active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            <span className={`size-1.5 rounded-full ${comp.bgClass}`} aria-hidden="true" />
            {league.fd_code}
            <span className="sr-only"> — {league.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
