import Link from 'next/link';
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
  days, leagues, now, eagerCrests = false, variant = 'default', chromeless = false,
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
  /**
   * `compact` is the landing dashboard's variant: the same rows inside a
   * ~600px board column instead of the full page width: a narrower day
   * rail, slightly shorter rows, and no venue / matchday line at all.
   *
   * It also swaps the row's centred home/score/away trio for two
   * left-aligned name columns — see the row markup below for why.
   *
   * The venue rule is the reason a prop exists rather than a breakpoint:
   * the venue line is hidden below `lg`, and `lg` is a *viewport* width. A
   * 600px column on a 1440px screen is past `lg`, so venue would render
   * into a column that cannot hold it. Only the caller knows how wide the
   * column it is placing this in actually is.
   */
  variant?: 'default' | 'compact';
  /**
   * Drops this component's own border/rounding/background — for a caller
   * that already supplies panel chrome around it (the landing dashboard's
   * board panels) and would otherwise draw a second frame inside the first.
   */
  chromeless?: boolean;
}) {
  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  const compact = variant === 'compact';
  const frameClass = chromeless ? '' : 'overflow-hidden rounded-xl border border-border bg-surface';

  if (days.length === 0) {
    return (
      <div className={`${chromeless ? 'bg-surface' : 'rounded-xl border border-border bg-surface'} p-6 text-sm text-muted`}>
        Nothing scheduled.
      </div>
    );
  }

  return (
    <div className={frameClass || 'bg-surface'}>
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
              <div className={`hidden shrink-0 border-r border-border sm:block ${compact ? 'w-11' : 'w-14'}`}>
                <div className="sticky top-0 flex flex-col items-center gap-0.5 py-2">
                  <span className={`font-display font-extrabold leading-none ${compact ? 'text-18' : 'text-24'}`}>{day}</span>
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
                      className={`flex items-center gap-2 border-b border-border pr-3 text-sm last:border-b-0 ${compact ? 'h-10' : 'h-11'}`}
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
                      <span className="w-20 shrink-0 whitespace-nowrap font-mono text-13 tabular-nums text-muted">{time}</span>

                      {/* Two left-aligned name columns with the score between them — NOT a
                          centred home/score/away trio, which is what this was and what the
                          dashboard spec's defect 2 reports: "fixture rows have large
                          horizontal voids at 1440px — content clustered centre, emptiness
                          either side". With the old fixed-width slots and `justify-end` on
                          the home side, a short name like "Bayern" left ~110px of empty box
                          between the kickoff time and the team on every single row, and the
                          whole trio floated in the middle of a 1150px row.

                          Aligning both names left turns that leading hole into ordinary
                          ragged-right trailing space, and because the two name cells are
                          equal `flex-1` with the same cap, the score still lands at the same
                          x on every row — the column reads as a table rather than a list of
                          centred islands. The cap is what stops the cells growing to half a
                          1150px row each; everything past it goes to the metadata group at
                          the right-hand end, which is real content rather than padding. */}
                      <span className={`flex min-w-0 flex-1 items-center gap-2 ${compact ? 'max-w-[8.5rem]' : 'max-w-[13rem]'}`}>
                        {/* Crests drop below `sm` in the compact variant: at 360px the row
                            has ~115px for two club names, and 26px of that each is a crest
                            sitting next to the name it duplicates. The name is the
                            information; recognition is what you can afford to lose first. */}
                        <span className={`shrink-0 ${compact ? 'hidden sm:block' : ''}`}>
                          <Crest team={fixture.home} size={compact ? 18 : 20} eager={eagerCrests} />
                        </span>
                        {/* Links to the club page when the fixture has a
                            club attached; "TBC" (a fixture whose teams the
                            provider has not confirmed) stays plain text,
                            because there is no club to link to. */}
                        {fixture.home ? (
                          <Link
                            href={`/team/${fixture.home.slug}`}
                            className={`truncate font-medium hover:underline ${compact ? 'text-14' : 'text-15'}`}
                          >
                            {fixture.home.short_name ?? fixture.home.name}
                          </Link>
                        ) : (
                          <span className={`truncate font-medium ${compact ? 'text-14' : 'text-15'}`}>TBC</span>
                        )}
                      </span>

                      <span className={`shrink-0 text-center font-mono font-semibold tabular-nums ${compact ? 'w-6 text-14' : 'w-8 text-15'}`}>
                        {center}
                      </span>

                      <span className={`flex min-w-0 flex-1 items-center gap-2 ${compact ? 'max-w-[8.5rem]' : 'max-w-[13rem]'}`}>
                        <span className={`shrink-0 ${compact ? 'hidden sm:block' : ''}`}>
                          <Crest team={fixture.away} size={compact ? 18 : 20} eager={eagerCrests} />
                        </span>
                        {/* Links to the club page when the fixture has a
                            club attached; "TBC" (a fixture whose teams the
                            provider has not confirmed) stays plain text,
                            because there is no club to link to. */}
                        {fixture.away ? (
                          <Link
                            href={`/team/${fixture.away.slug}`}
                            className={`truncate font-medium hover:underline ${compact ? 'text-14' : 'text-15'}`}
                          >
                            {fixture.away.short_name ?? fixture.away.name}
                          </Link>
                        ) : (
                          <span className={`truncate font-medium ${compact ? 'text-14' : 'text-15'}`}>TBC</span>
                        )}
                      </span>

                      {/* The competition code, pushed to the right-hand end by `ml-auto`,
                          taking the row's leftover width. Information, not filler: until
                          now the only per-row signal for "which league" was the colour bar
                          at the left edge, and this app's rule is that colour is never the
                          sole carrier of meaning (the full name is still rendered for
                          assistive tech below). Dropped below `sm` in compact for the same
                          width reason as the crests. */}
                      <span
                        className={`ml-auto shrink-0 pl-2 font-mono text-11 font-semibold uppercase tracking-wider text-muted ${
                          compact ? 'hidden sm:block' : ''
                        }`}
                      >
                        {comp.code || '—'}
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
                              <span className="tl-live-dot size-1.5 rounded-full bg-live" aria-hidden="true" />
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
                      {!compact && (fixture.matchday !== null || venue) && (
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
