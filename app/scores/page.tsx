import { getLeagues } from '@/lib/site/queries/leagues';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { LeagueFilter } from '@/components/LeagueFilter';
import { ScoreRow } from '@/components/ScoreRow';
import { LiveScores } from '@/components/LiveScores';
import { formatKickoff } from '@/lib/site/format';

export const revalidate = 60;

export default async function ScoresPage({
  searchParams,
}: { searchParams: Promise<{ leagues?: string }> }) {
  const { leagues: raw } = await searchParams;
  const selected = raw ? raw.split(',').filter(Boolean) : [];

  const now = new Date();
  const [leagues, recent, upcoming] = await Promise.all([
    getLeagues(),
    getLiveAndRecent(now),
    getUpcoming(now, 20),
  ]);

  const byId = new Map(leagues.map((l) => [l.id, l]));
  const keep = (leagueId: number) =>
    selected.length === 0 || selected.includes(byId.get(leagueId)?.fd_code ?? '');

  const shownRecent = recent.filter((f) => keep(f.league_id));
  const shownUpcoming = upcoming.filter((f) => keep(f.league_id));
  const nextKickoff = shownUpcoming[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Scores</h1>
        <LeagueFilter leagues={leagues} selected={selected} basePath="/scores" />
      </div>

      {shownRecent.length > 0 ? (
        <LiveScores initial={shownRecent} nowIso={now.toISOString()} />
      ) : (
        <section className="rounded-xl border border-border bg-surface p-6">
          <p className="text-sm font-semibold">No matches in progress</p>
          <p className="mt-1 text-sm text-muted">
            {nextKickoff
              ? <>Next up: {nextKickoff.home?.name} v {nextKickoff.away?.name}, {formatKickoff(nextKickoff.kickoff_utc, now)}.</>
              : <>No fixtures scheduled in the selected competitions.</>}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Upcoming</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {shownUpcoming.length === 0 && (
            <li className="px-3 py-6 text-sm text-muted">Nothing scheduled.</li>
          )}
          {shownUpcoming.map((f) => <ScoreRow key={f.id} fixture={f} now={now} />)}
        </ul>
      </section>
    </div>
  );
}
