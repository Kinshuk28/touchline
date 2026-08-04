import Link from 'next/link';
import { getFixturesInRange } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { parseLeagueCodes, resolveLeagueIds } from '@/lib/site/leagueFilter';
import { LeagueFilter } from '@/components/LeagueFilter';
import { Crest } from '@/components/Crest';
import { formatKickoffTime } from '@/lib/site/format';
import { stateLabel } from '@/lib/site/scoreDisplay';

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

  const nameById = new Map(leagues.map((l) => [l.id, l.name]));
  const byDay = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    const day = f.kickoff_utc.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), f]);
  }

  const icsHref = selected.length > 0
    ? `/api/calendar.ics?leagues=${selected.join(',')}`
    : '/api/calendar.ics';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/calendar" />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-muted">Showing the next {weeks} week{weeks === 1 ? '' : 's'} (UTC)</span>
        <a href={icsHref} className="rounded border border-border px-2 py-1 font-semibold uppercase tracking-wider text-muted hover:text-text">
          Subscribe (.ics)
        </a>
      </div>

      {byDay.size === 0 && (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
          No fixtures in this window for the selected competitions.
        </p>
      )}

      <div className="space-y-5">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {new Date(`${day}T00:00:00Z`).toUTCString().slice(0, 11)}
            </h2>
            <ul className="overflow-hidden rounded-xl border border-border bg-surface">
              {list.map((f) => {
                // Important 4: getFixturesInRange applies no status filter,
                // so a postponed/cancelled/suspended fixture shows up here
                // exactly like a real one unless labelled. Chose to label
                // rather than exclude (unlike buildIcs, which must exclude —
                // a calendar subscription is fire-and-forget with no chance
                // to re-check, but a page the user is looking at right now
                // can just say so): the fixture stays visible with its
                // originally scheduled time, honestly marked, rather than
                // silently vanishing from a view the user already has open.
                const state = stateLabel(f);
                return (
                  <li key={f.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted tabular-nums">
                      {formatKickoffTime(f.kickoff_utc, now, { dateContext: true })}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Crest team={f.home} size={20} />
                      <span className="truncate text-sm">{f.home?.name ?? 'TBC'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">v</span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Crest team={f.away} size={20} />
                      <span className="truncate text-sm">{f.away?.name ?? 'TBC'}</span>
                    </span>
                    {state && (
                      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${state.live ? 'text-live' : 'text-muted'}`}>
                        {state.text}
                      </span>
                    )}
                    <span className="hidden w-28 shrink-0 text-right text-[11px] text-muted sm:block">
                      {nameById.get(f.league_id)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-muted">
        All times shown in UTC. <Link href="/scores" className="underline">Scores</Link>
      </p>
    </div>
  );
}
