import { Crest } from '@/components/Crest';
import { primaryClubColor } from '@/lib/site/clubColors';
import {
  formatGoalDifference, isUnplayedSeason, seasonLabel, sortStandingsForDisplay,
} from '@/lib/site/standingsDisplay';
import type { LeagueRow, StandingRow } from '@/lib/site/rows';

/**
 * The compact standings variant the dashboard spec allows ("`StandingsTable`
 * (a compact variant is fine)"). Same data, same decisions — order and the
 * unplayed-season honesty both come from `lib/site/standingsDisplay.ts`, so
 * this and the full table on /tables can never disagree about what a
 * season's rows mean — but four columns instead of ten and no sticky club
 * column, because at ~340px of board width there is nothing to scroll.
 *
 * P / GD / Pts is the smallest set that is still a league table: matches
 * played says how far in the season is, goal difference is the tiebreaker
 * that decides the order you are looking at, points is the ranking itself.
 * W/D/L and GF/GA are one click away on /tables.
 *
 * Rows are capped by `limit` (the spec's "top 6 + link"); the caller
 * supplies the link, since it owns the panel chrome around this.
 */
export function MiniTable({
  league, rows, limit = 6,
}: { league: LeagueRow; rows: StandingRow[]; limit?: number }) {
  const unplayed = isUnplayedSeason(rows);
  const sorted = sortStandingsForDisplay(rows).slice(0, limit);

  if (sorted.length === 0) {
    return <p className="px-3 py-4 text-13 text-muted">No table available for {league.name}.</p>;
  }

  return (
    <>
      {unplayed && (
        // Never presented as a ranking — the same honesty rule /tables
        // applies, in one line instead of a paragraph.
        <p className="border-b border-border px-3 py-1.5 text-11 text-muted">
          {seasonLabel(sorted[0]?.season ?? 0)} not yet played — listed alphabetically, not by rank.
        </p>
      )}
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {league.name}, {seasonLabel(sorted[0]?.season ?? 0)}
          {unplayed ? ' (not yet played)' : ''} — top {sorted.length}
        </caption>
        <thead>
          <tr className="border-b border-border text-11 uppercase tracking-wide text-muted">
            <th scope="col" className="px-3 py-1.5 text-left font-semibold">Club</th>
            <th scope="col" className="px-1.5 py-1.5 text-right font-semibold">P</th>
            <th scope="col" className="px-1.5 py-1.5 text-right font-semibold">GD</th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const clubColor = primaryClubColor(row.team?.club_colors);
            return (
              <tr key={row.team_id} className="border-b border-border last:border-b-0">
                <td className="py-1.5 pl-3 pr-1">
                  <div className="flex items-center gap-2">
                    {/* Club colour as a bar, never as the club's only
                        identifier — the name is always there as text. A
                        club whose stored colours don't parse gets the
                        hairline colour, not an invented one. */}
                    <span
                      className={`h-4 w-0.5 shrink-0 rounded-full ${clubColor ? '' : 'bg-border'}`}
                      style={clubColor ? { background: clubColor } : undefined}
                      aria-hidden="true"
                    />
                    <span className="w-3 shrink-0 text-right font-mono text-11 tabular-nums text-muted">
                      {unplayed ? '·' : i + 1}
                    </span>
                    <Crest team={row.team} size={18} />
                    <span className="truncate text-13 font-medium">
                      {row.team?.short_name ?? row.team?.name ?? 'Unknown club'}
                    </span>
                  </div>
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono text-13 tabular-nums text-muted">{row.played}</td>
                <td className="px-1.5 py-1.5 text-right font-mono text-13 tabular-nums text-muted">
                  {formatGoalDifference(row.goal_difference)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-13 font-bold tabular-nums">{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
