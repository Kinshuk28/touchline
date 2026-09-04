import Link from 'next/link';
import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { LeagueFilter } from '@/components/LeagueFilter';
import { MatchdaySpine } from '@/components/MatchdaySpine';
import { groupFixturesByDay } from '@/lib/site/spine';

export const revalidate = 900;

const DAY_MS = 86_400_000;

export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string; weeks?: string }> }) {
  const { leagues: raw, weeks: weeksRaw } = await searchParams;
  const selected = parseLeagueCodes(raw);
  const weeks = Math.min(Math.max(Number.parseInt(weeksRaw ?? '4', 10) || 4, 1), 12);

  const leagues = await getLeagues();
  const ids = selected.length > 0 ? resolveLeagueIds(leagues, selected) : undefined;

  const now = new Date();
  const to = new Date(now.getTime() + weeks * 7 * DAY_MS);
  const fixtures = await getFixturesInRange(now.toISOString(), to.toISOString(), ids);
  const days = groupFixturesByDay(fixtures);

  const icsHref = selected.length > 0
    ? `/api/calendar.ics?leagues=${selected.join(',')}`
    : '/api/calendar.ics';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/calendar" />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-11">
        <span className="text-muted">Showing the next {weeks} week{weeks === 1 ? '' : 's'} (IST)</span>
        <a href={icsHref} className="rounded border border-border px-2 py-1 font-semibold uppercase tracking-wider text-muted hover:text-text">
          Subscribe (.ics)
        </a>
      </div>

      {/* Day-grouped via the matchday spine — its own sticky day rail and
          competition colour bar carry both the date grouping and the league
          identity, so the old right-hand league-name column (redundant next
          to the colour bar) is gone. */}
      <MatchdaySpine days={days} leagues={leagues} now={now} />

      <p className="text-11 text-muted">
        All times shown in IST. <Link href="/scores" className="underline">Scores</Link>
      </p>
    </div>
  );
}
