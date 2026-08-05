import { Crest } from '@/components/Crest';
import { clubBarGradient } from '@/lib/site/clubColors';
import { getCompetitionMeta } from '@/lib/site/competition';
import { formatKickoffTime } from '@/lib/site/format';
import { dayRailParts, spineCenterText, spineRowKind, spineStateLabel } from '@/lib/site/spine';
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
                  const state = spineStateLabel(fixture);
                  // Real per-match data, one gradient per fixture — the two clubs' actual
                  // colours, never invented (lib/site/clubColors.ts). `null` when neither
                  // club's `club_colors` parses; the competition bar to its left still
                  // carries the row, so a null club colour never reads as broken.
                  const clubGradient = clubBarGradient(fixture.home?.club_colors, fixture.away?.club_colors);
                  const venue = fixture.home?.venue ?? null;

                  return (
                    <li
                      key={fixture.id}
                      data-fixture-id={fixture.id}
                      className="flex h-11 items-center gap-2 border-b border-border pr-3 text-sm last:border-b-0"
                    >
                      {/* Two bars, deliberately kept visually distinct so neither reads as
                          noise or gets mistaken for the other (they carry different meanings):
                          the competition bar is the leftmost 3px, solid and at full opacity —
                          unchanged from before this piece, still the "which league" signal.
                          The club-colour bar sits immediately to its right, twice as wide (6px)
                          and at 60% opacity — a real two-stop gradient between the two clubs'
                          own colours, different on every single row, which is the whole point
                          of Direction Two's "club colour is the only chroma" move. Position
                          (leftmost vs. adjacent), width (3px vs 6px) and opacity (100% vs 60%)
                          all differ, so even side by side the two never compete for "loudest
                          colour in the row." The club slot's width is always reserved, even
                          when `clubGradient` is null, so a club with no parseable colour
                          doesn't shift every other row's text out of alignment. */}
                      <span className="flex h-full shrink-0" aria-hidden="true">
                        <span className={`h-full w-[3px] ${comp.bgClass}`} />
                        <span
                          className={`h-full w-1.5 ${clubGradient ? 'opacity-60' : ''}`}
                          style={clubGradient ? { background: clubGradient } : undefined}
                        />
                      </span>
                      {/* Wide enough for the longest kickoff string this ever renders ("Sat
                          19:30", via `dateContext`) with a little breathing room either side —
                          was `w-11` (44px), sized only for same-day "17:30" and truncating the
                          weekday-prefixed form used for everything beyond today. `w-[4.5rem]`
                          (72px) measured as the exact text width with under 1px of slack, which
                          read as the time running straight into the team name; `w-20` leaves a
                          visible gap. */}
                      <span className="w-20 shrink-0 font-mono text-13 tabular-nums text-muted">{time}</span>

                      {/* The home/score/away trio is centered as one unit in the space between
                          the time column and the status column, with fixed-width team-name slots
                          either side of the score from `sm:` up — so the score lands at the same
                          horizontal position every row ("stay put down the column") and short
                          team names no longer leave a lopsided gutter between the time and the
                          teams (previously each team slot was its own flex-1, which let a short
                          name's box stay mostly empty right after the time column).
                          Below `sm`, the fixed widths revert to the original elastic `flex-1`:
                          at 360px there isn't 2x160px-plus-crests of room between the time and
                          status columns to begin with (the dead-gutter complaint this is fixing
                          was specifically about the 1280px view), and forcing that width there
                          made the shrink-0'd trio wider than its flex-1 parent, overflowing left
                          and running the score cluster straight into the kickoff time. */}
                      <span className="flex min-w-0 flex-1 items-center justify-center gap-2">
                        <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right sm:w-40 sm:flex-none">
                          <span className="truncate text-15 font-medium">
                            {fixture.home?.short_name ?? fixture.home?.name ?? 'TBC'}
                          </span>
                          <Crest team={fixture.home} size={20} eager={eagerCrests} />
                        </span>

                        <span className="shrink-0 px-1 text-center font-mono text-15 font-semibold tabular-nums">{center}</span>

                        <span className="flex min-w-0 flex-1 items-center gap-2 sm:w-40 sm:flex-none">
                          <Crest team={fixture.away} size={20} eager={eagerCrests} />
                          <span className="truncate text-15 font-medium">
                            {fixture.away?.short_name ?? fixture.away?.name ?? 'TBC'}
                          </span>
                        </span>
                      </span>

                      {/* Reclaimed rather than always reserved, same reasoning as
                          /scores' CompetitionGroup: at 360px this row is already tight between
                          a mandatory weekday-prefixed time column and two team names either
                          side of the score, and the vast majority of rows — every upcoming
                          fixture, which in preseason is nearly all of them — have no state text
                          to show here at all. Driven by `spineStateLabel`, not `kind`, now that
                          it needs to say more than "live"/"postponed" (HT vs Live, Postp. vs
                          Off) — see that function's doc comment. */}
                      {state && (
                        <span className="w-16 shrink-0 whitespace-nowrap text-right text-11 font-semibold uppercase tracking-wide">
                          {state.live ? (
                            <span className="inline-flex items-center gap-1 text-live">
                              <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                              {state.text}
                            </span>
                          ) : (
                            <span className="text-muted">{state.text}</span>
                          )}
                        </span>
                      )}

                      {/* Venue and matchday — Direction Two's football vernacular, "supporting,
                          not shouting": muted, mono-free small text, hidden below `lg` rather
                          than wrapped (spec: venue "must never crowd the team names" and "on
                          narrow screens it should drop out entirely rather than wrap"). Home
                          team's venue — the match is played there. Both are real per-fixture
                          data (96/110 clubs have a venue; matchday is null pre-fixture-list for
                          some competitions) and omitted, never guessed, when absent. */}
                      {(fixture.matchday !== null || venue) && (
                        <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap pl-1 text-11 text-muted lg:flex">
                          {fixture.matchday !== null && <span>Matchday {fixture.matchday}</span>}
                          {fixture.matchday !== null && venue && <span aria-hidden="true">·</span>}
                          {venue && <span className="max-w-[10rem] truncate">{venue}</span>}
                        </span>
                      )}

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
