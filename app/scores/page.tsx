import { getLeagues } from '@/lib/site/queries/leagues';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { getFollowingLeagues } from '@/lib/site/following';
import { LeagueFilter } from '@/components/LeagueFilter';
import { LiveScores } from '@/components/LiveScores';
import { FollowToggle } from '@/components/FollowToggle';
import { Crest } from '@/components/Crest';
import { formatKickoffTime } from '@/lib/site/format';
import { countdownParts } from '@/lib/site/countdown';
import { getCompetitionMeta } from '@/lib/site/competition';
import { spineRowKind, spineCenterText } from '@/lib/site/spine';
import type { FixtureWithTeams, LeagueRow } from '@/lib/site/rows';

// Inert today: reading `searchParams` below forces this whole route to
// dynamic rendering, so Next.js never applies a segment-level `revalidate`
// to it (confirmed in .superpowers/sdd/task-6-report.md — the route still
// renders `ƒ` dynamic under `next build` with zero DB credentials, meaning
// the page body never runs at build time). Left in as documented intent: if
// `searchParams` usage is ever removed and the page becomes ISR-eligible,
// 60s is already a sane cap, comfortably below the 5-minute ingest cadence.
export const revalidate = 60;

/**
 * One competition's rows within the "Upcoming" section — a coloured header
 * bar (league name, fixture count, its own Follow toggle) over the same
 * 44px row the matchday spine uses, reimplemented here (not
 * `<MatchdaySpine>` itself) because that component groups by *day*, not by
 * competition; the two pages group the same row shape along different axes.
 * `spineRowKind`/`spineCenterText` are the exact pure functions the spine
 * uses, imported directly, so the two never disagree about what a row shows.
 */
function CompetitionGroup({
  league, fixtures, now, following, eager,
}: { league: LeagueRow; fixtures: FixtureWithTeams[]; now: Date; following: string[]; eager: boolean }) {
  const comp = getCompetitionMeta(league.fd_code);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className={`flex items-center gap-3 border-b-2 bg-surface-2 px-3 py-2 ${comp.borderClass}`}>
        <span className={`h-4 w-1 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
        <h3 className="font-display text-15 font-bold uppercase tracking-wide">{league.name}</h3>
        <span className="font-mono text-11 text-muted">
          {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto">
          <FollowToggle code={league.fd_code} name={league.name} initiallyFollowing={following.includes(league.fd_code)} />
        </div>
      </div>
      <ul>
        {fixtures.map((f) => {
          const kind = spineRowKind(f);
          const center = spineCenterText(f, kind);
          const time = formatKickoffTime(f.kickoff_utc, now);
          return (
            <li
              key={f.id}
              data-fixture-id={f.id}
              className="flex h-11 items-center gap-1 border-b border-border px-2 text-sm last:border-b-0 sm:gap-2 sm:px-3"
            >
              {/* `formatKickoffTime` with no `dateContext` (this page has no day heading
                  to lean on) can render as long as "16 Aug 19:00" for anything more than a
                  week out — the common case in preseason — at `sm:` and up, where there's
                  room for it. Below `sm`, the same string would alone eat over half the row,
                  so mobile keeps the shorter same-day-shaped width and simply lets a longer
                  string wrap rather than collide with the score cluster next to it. */}
              <span className="w-14 shrink-0 font-mono text-13 tabular-nums text-muted sm:w-32">{time}</span>
              {/* Home/score/away centered as one unit in the remaining space, with
                  fixed-width team-name slots either side of the score from `sm:` up, so the
                  score lands at a consistent horizontal position down the list instead of each
                  team's flex-1 box leaving a lopsided gutter between the time and the teams.
                  Below `sm`, the slots revert to plain elastic `flex-1` (`sm:flex-none` cancels
                  that back out once the fixed width applies): at 360px there isn't
                  2x160px-plus-crests of room between the time and status columns, and forcing
                  it there overflowed the flex-1 parent and ran the score cluster into the
                  kickoff time — the dead-gutter complaint this fixes was specifically about the
                  1280px view. */}
              <span className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-2">
                <span className="flex min-w-0 flex-1 items-center justify-end gap-1 text-right sm:w-40 sm:flex-none sm:gap-2">
                  <span className="truncate text-15 font-medium">{f.home?.short_name ?? f.home?.name ?? 'TBC'}</span>
                  <Crest team={f.home} size={28} eager={eager} />
                </span>
                <span className="shrink-0 px-1 text-center font-mono text-15 font-semibold tabular-nums">{center}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1 sm:w-40 sm:flex-none sm:gap-2">
                  <Crest team={f.away} size={28} eager={eager} />
                  <span className="truncate text-15 font-medium">{f.away?.short_name ?? f.away?.name ?? 'TBC'}</span>
                </span>
              </span>
              {/* Reclaimed rather than always reserved (Important, mobile):
                  at 360px a fixed-width state column left almost nothing for
                  the two flex-1 team names, truncating "Arsenal" down to a
                  single letter. Upcoming fixtures — the vast majority in
                  preseason — have no state text to show at all, so this
                  column only exists when there's something to put in it. */}
              {(kind === 'live' || kind === 'postponed') && (
                <span className="w-14 shrink-0 text-right text-11 font-semibold uppercase tracking-wide sm:w-16">
                  {kind === 'live' && (
                    <span className="inline-flex items-center gap-1 text-live">
                      <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                      Live
                    </span>
                  )}
                  {kind === 'postponed' && <span className="text-muted">Postponed</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The preseason primary view (spec: "it is the primary view until
 * 2026-08-16, not a fallback"), so it gets a full prominent card — the
 * next fixture's teams and crests plus a large mono countdown — rather than
 * the small single-line `<Countdown>` used in the landing ticker.
 */
function NextFixtureCard({ fixture, now }: { fixture: FixtureWithTeams; now: Date }) {
  const parts = countdownParts(fixture.kickoff_utc, now);
  return (
    <section className="rounded-xl border border-border bg-surface p-6 text-center sm:p-10">
      <p className="text-11 font-bold uppercase tracking-wider text-muted">Next fixture</p>
      <div className="mt-4 flex items-center justify-center gap-3 sm:gap-4">
        <Crest team={fixture.home} size={36} eager />
        <span className="font-display text-18 font-bold sm:text-24">
          {fixture.home?.short_name ?? fixture.home?.name ?? 'TBC'}
          <span className="mx-2 text-muted">v</span>
          {fixture.away?.short_name ?? fixture.away?.name ?? 'TBC'}
        </span>
        <Crest team={fixture.away} size={36} eager />
      </div>
      <p className="mt-2 font-mono text-13 text-muted">{formatKickoffTime(fixture.kickoff_utc, now)}</p>
      <p className="mt-5 font-mono text-32 font-extrabold tabular-nums sm:text-44">
        {parts ? (parts.days > 0 ? `${parts.days}d ${parts.hours}h` : `${parts.hours}h`) : 'Under way'}
      </p>
    </section>
  );
}

export default async function ScoresPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  // An explicit `?leagues=` — including `?leagues=` with an empty value —
  // always wins, so a shared link stays predictable (spec's "Following"
  // section). Only when the param is absent entirely does a followed-league
  // preference supply the default; following nothing behaves exactly like
  // today (`selected` unfiltered). The league *pills* below always reflect
  // `selected` (the literal query string), never the following-derived
  // default, so the filter UI never shows an "active" state the URL itself
  // doesn't contain.
  const selected = parseLeagueCodes(raw);
  const following = await getFollowingLeagues();
  const effectiveSelected = raw !== undefined || following.length === 0 ? selected : following;

  const now = new Date();
  const leagues = await getLeagues();

  // Resolved once, up front — `getUpcoming`'s `limit` must apply *after*
  // this scoping, not before, or a league whose fixtures sort past the
  // unscoped top N gets truncated away before it can be filtered to, and
  // the page falsely renders "Nothing scheduled" for a league that has
  // real fixtures in the database (Finding 1). `undefined` means every
  // league, matching `getUpcoming`/`getLiveAndRecent`'s own "no filter"
  // meaning; an unrecognised code resolves to `[]`, which both queries
  // treat as "match nothing", never "everything".
  const selectedLeagueIds = effectiveSelected.length > 0 ? resolveLeagueIds(leagues, effectiveSelected) : undefined;

  const [recent, upcoming] = await Promise.all([
    getLiveAndRecent(now, selectedLeagueIds),
    getUpcoming(now, 20, selectedLeagueIds),
  ]);

  const nextKickoff = upcoming[0];
  const groups = leagues
    .map((league) => ({ league, fixtures: upcoming.filter((f) => f.league_id === league.id) }))
    .filter((g) => g.fixtures.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Scores</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/scores" />
      </div>

      <LiveScores
        // Forces a clean remount on every filter change (Finding 2).
        // `<LiveScores>` seeds its state from `initial`/`useRef` only on
        // first mount; without a `key` tied to the selection, a
        // client-side navigation between two `?leagues=` URLs reconciles
        // it as the *same* instance and just updates props in place, so
        // the panel keeps showing the previous filter's live fixtures
        // until the next poll (or, since the ref merges rather than
        // replaces, potentially longer).
        key={effectiveSelected.length > 0 ? effectiveSelected.join(',') : 'all'}
        initial={recent}
        nowIso={now.toISOString()}
        leagues={effectiveSelected}
        leagueIds={selectedLeagueIds}
        // Always mounted now (Important 5), even when `recent` is empty —
        // otherwise the poll loop never starts for a page opened before
        // kickoff, and this card would still be showing at 15:30 with a
        // match already in progress.
        emptyState={
          nextKickoff ? <NextFixtureCard fixture={nextKickoff} now={now} /> : (
            <section className="rounded-xl border border-border bg-surface p-6">
              <p className="text-sm font-semibold">No matches in progress</p>
              <p className="mt-1 text-sm text-muted">No fixtures scheduled in the selected competitions.</p>
            </section>
          )
        }
      />

      <section>
        <h2 className="mb-2 text-11 font-bold uppercase tracking-[0.14em] text-muted">Upcoming</h2>
        {groups.length === 0 && (
          <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">Nothing scheduled.</p>
        )}
        <div className="space-y-3">
          {groups.map((g, i) => (
            <CompetitionGroup key={g.league.id} league={g.league} fixtures={g.fixtures} now={now} following={following} eager={i === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}
