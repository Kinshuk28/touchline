import { Fragment } from 'react';
import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { getCompetitionMeta } from '@/lib/site/competition';
import { primaryClubColor } from '@/lib/site/clubColors';
import {
  isUnplayedSeason, sortStandingsForDisplay, formatGoalDifference, parseForm, seasonLabel,
} from '@/lib/site/standingsDisplay';
import { relegationZones, zoneKindForPosition } from '@/lib/site/tableZones';
import type { LeagueRow, StandingRow } from '@/lib/site/rows';

// Club-name column plus P W D L GF GA GD Pts = 9 columns, matching the
// spec's "a 9-column table needs real thought at [360px]"; Form is a 10th,
// added only from `lg:` up (see the <th>/<td> below) rather than squeezed
// into the same 9 at every width.
const VISIBLE_COLUMNS = 9;

function FormStrip({ form }: { form: string | null }) {
  const letters = parseForm(form);
  if (!letters) return <span className="text-muted">—</span>;
  return (
    <span className="flex justify-end gap-1" aria-label={`Last ${letters.length} results: ${letters.join(', ')}`}>
      {letters.map((letter, i) => (
        // Weight, not colour, carries the meaning here — this app's only
        // chroma systems are per-competition and per-club colour (spec: "no
        // house accent"), and a result strip is neither, so it stays on the
        // chalk/border palette: a win is a filled chip, a draw or loss an
        // outlined one, distinguished from each other by the letter itself.
        <span
          key={i}
          aria-hidden="true"
          className={`grid size-4 place-items-center rounded-[3px] text-[9px] font-bold ${
            letter === 'W' ? 'bg-text text-bg' : 'border border-border text-muted'
          }`}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

/**
 * One competition's table: coloured header, sticky club column (so identity
 * stays put while P/W/D/L/... scroll under a narrow viewport — the "real
 * thought" the spec asks for at 360px, rather than shrinking every column
 * until it's unreadable), and relegation-boundary hairlines with a text
 * label, never colour alone.
 *
 * `rows` is the raw, unsorted query result for one league+season — this
 * component is the single place that decides display order and whether the
 * season counts as "played" (`isUnplayedSeason`/`sortStandingsForDisplay`,
 * lib/site/standingsDisplay.ts), so a caller can never accidentally treat
 * an all-zero season's stored `position` as a real ranking.
 */
export function StandingsTable({ league, rows }: { league: LeagueRow; rows: StandingRow[] }) {
  const comp = getCompetitionMeta(league.fd_code);
  const unplayed = isUnplayedSeason(rows);
  const sorted = sortStandingsForDisplay(rows);
  // Relegation-only boundaries (see lib/site/tableZones.ts for why no
  // European-qualification lines are drawn), and only meaningful once the
  // season has real results — an unplayed season's rows are an alphabetical
  // list, not a ranking, so no boundary belongs on it.
  const zones = unplayed ? [] : relegationZones(league.fd_code, rows.length);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className={`flex items-center gap-3 border-b-2 bg-surface-2 px-4 py-3 ${comp.borderClass}`}>
        <span className={`h-4 w-1 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
        <h2 className="font-display text-15 font-bold uppercase tracking-wide">{league.name}</h2>
        {unplayed && (
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-11 font-semibold uppercase tracking-wide text-muted">
            Not yet played
          </span>
        )}
      </header>

      {sorted.length === 0 ? (
        <p className="p-4 text-sm text-muted">No standings available for {league.name}.</p>
      ) : (
        <>
          {unplayed && (
            <p className="border-b border-border bg-surface-2/60 px-4 py-2 text-11 text-muted">
              {seasonLabel(sorted[0]?.season ?? 0)} has not kicked off — every club sits on P0, Pts0. Listed
              alphabetically, not by rank.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">
                {league.name} table, {seasonLabel(sorted[0]?.season ?? 0)}{unplayed ? ' (not yet played)' : ''}
              </caption>
              <thead>
                <tr className="border-b border-border bg-surface-2 text-11 uppercase tracking-wide text-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-semibold">Club</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">P</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">W</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">D</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">L</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">GF</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">GA</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">GD</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Pts</th>
                  <th scope="col" className="hidden px-2 py-2 text-right font-semibold lg:table-cell">Form</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const pos = i + 1;
                  const zone = zones.find((z) => z.afterPosition === pos - 1);
                  const zoneKind = zoneKindForPosition(zones, pos);
                  const clubColor = primaryClubColor(row.team?.club_colors);
                  const rowTintClass = zoneKind ? 'bg-surface-2/60' : '';
                  const stickyBgClass = zoneKind ? 'bg-surface-2' : 'bg-surface';

                  return (
                    <Fragment key={row.team_id}>
                      {zone && (
                        <tr aria-hidden="true">
                          <td colSpan={VISIBLE_COLUMNS + 1} className="border-t-2 border-border bg-surface-2/40 px-3 py-1">
                            <span className="text-11 font-semibold uppercase tracking-wide text-muted">{zone.label}</span>
                          </td>
                        </tr>
                      )}
                      <tr className={`border-b border-border last:border-b-0 ${rowTintClass}`}>
                        <td className={`sticky left-0 z-10 px-3 py-2 ${stickyBgClass}`}>
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-5 w-1 shrink-0 rounded-full ${clubColor ? '' : 'bg-border'}`}
                              style={clubColor ? { background: clubColor } : undefined}
                              aria-hidden="true"
                            />
                            <span className="w-5 shrink-0 text-right font-mono text-13 tabular-nums text-muted">{pos}</span>
                            <Crest team={row.team} size={22} />
                            {/* The club name is the way into /team/[slug] —
                                same pattern as the landing board's
                                MiniTable, which already links this. `row.team`
                                is null only if a standings row outlives its
                                club, which the schema allows; text with
                                nowhere to go is better than a link to
                                nowhere. */}
                            {row.team ? (
                              <Link href={`/team/${row.team.slug}`} className="truncate text-14 font-medium hover:underline">
                                {row.team.short_name ?? row.team.name}
                              </Link>
                            ) : (
                              <span className="truncate text-14 font-medium">Unknown club</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.played}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.won}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.drawn}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.lost}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.goals_for}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{row.goals_against}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 tabular-nums">{formatGoalDifference(row.goal_difference)}</td>
                        <td className="px-2 py-2 text-right font-mono text-13 font-bold tabular-nums">{row.points}</td>
                        <td className="hidden px-2 py-2 text-right lg:table-cell">
                          <FormStrip form={row.form} />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
