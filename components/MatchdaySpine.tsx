import { Crest } from '@/components/Crest';
import { getCompetitionMeta } from '@/lib/site/competition';
import { formatKickoffTime } from '@/lib/site/format';
import { dayRailParts, spineCenterText, spineRowKind } from '@/lib/site/spine';
import type { FixtureWithTeams, LeagueRow } from '@/lib/site/rows';

export interface SpineDay {
  /** `YYYY-MM-DD`, UTC — the day this group's fixtures kick off on. */
  date: string;
  fixtures: FixtureWithTeams[];
}

/**
 * The matchday spine — the redesign's signature element: a time-ordered
 * rail of fixtures grouped by day, used on the landing page and /calendar
 * (Plan B2 wires it into both). Pure presentation over data the caller has
 * already grouped by day; no query, no client state, so this stays a plain
 * server component.
 */
export function MatchdaySpine({
  days, leagues, now, eagerCrests = false,
}: {
  days: SpineDay[];
  leagues: LeagueRow[];
  now: Date;
  /**
   * `loading="eager"` on every crest this spine renders — the caller's job
   * to set only for an instance that's above the fold on first paint (see
   * the redesign spec's /scores section). Defaults to lazy everywhere else.
   */
  eagerCrests?: boolean;
}) {
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        Nothing scheduled.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {days.map(({ date, fixtures }, i) => {
        const { day, month, weekday } = dayRailParts(date);
        return (
          <div key={date} className={i > 0 ? 'border-t border-border' : ''}>
            {/* Mobile: the rail collapses to a single date line (quality floor: responsive to 360px). */}
            <p className="border-b border-border bg-surface px-3 py-1.5 text-11 font-bold uppercase tracking-wider text-muted sm:hidden">
              {weekday} {day} {month}
            </p>
            <div className="flex items-stretch">
              {/* The rail's day/month label is sticky *within this column* — pinned to the
                  viewport top while its day group's rows scroll past, released once the next
                  day group's own rail takes over. Hidden below `sm`, where the mobile date
                  line above stands in for it instead (quality floor: collapses to 360px). */}
              <div className="hidden w-14 shrink-0 border-r border-border sm:block">
                <div className="sticky top-0 flex flex-col items-center gap-0.5 py-2">
                  <span className="font-display text-24 font-extrabold leading-none">{day}</span>
                  <span className="text-11 font-semibold uppercase tracking-wider text-muted">{month}</span>
                </div>
              </div>
              <ul className="min-w-0 flex-1">
                {fixtures.map((fixture) => {
                  const league = leagueById.get(fixture.league_id);
                  const comp = getCompetitionMeta(league?.fd_code ?? '');
                  const kind = spineRowKind(fixture);
                  const center = spineCenterText(fixture, kind);
                  const time = formatKickoffTime(fixture.kickoff_utc, now, { dateContext: true });

                  return (
                    <li
                      key={fixture.id}
                      data-fixture-id={fixture.id}
                      className="flex h-11 items-center gap-2 border-b border-border pr-3 text-sm last:border-b-0"
                    >
                      <span className={`h-full w-[3px] shrink-0 ${comp.bgClass}`} aria-hidden="true" />
                      <span className="w-11 shrink-0 font-mono text-13 tabular-nums text-muted">{time}</span>

                      <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
                        <span className="truncate text-15 font-medium">
                          {fixture.home?.short_name ?? fixture.home?.name ?? 'TBC'}
                        </span>
                        <Crest team={fixture.home} size={20} eager={eagerCrests} />
                      </span>

                      <span className="shrink-0 px-1 font-mono text-15 font-semibold tabular-nums">{center}</span>

                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <Crest team={fixture.away} size={20} eager={eagerCrests} />
                        <span className="truncate text-15 font-medium">
                          {fixture.away?.short_name ?? fixture.away?.name ?? 'TBC'}
                        </span>
                      </span>

                      <span className="w-16 shrink-0 whitespace-nowrap text-right text-11 font-semibold uppercase tracking-wide">
                        {kind === 'live' && (
                          <span className="inline-flex items-center gap-1 text-live">
                            <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                            Live
                          </span>
                        )}
                        {kind === 'postponed' && <span className="text-muted">Postponed</span>}
                      </span>

                      {/* Competition colour is never the only carrier of meaning — the league name is always present as text, here for assistive tech. */}
                      <span className="sr-only">{comp.name}</span>
                    </li>
                  );
                })}
                {fixtures.length === 0 && (
                  <li className="px-3 py-3 text-13 text-muted">Nothing scheduled.</li>
                )}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
