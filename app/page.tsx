import Link from 'next/link';
import { getTrendingNews } from '@/lib/site/queries/news';
import { getLiveAndRecent, getUpcoming } from '@/lib/site/queries/fixtures';
import { getNextKickoffPerLeague } from '@/lib/site/queries/leagues';
import { LiveScores } from '@/components/LiveScores';
import { NewsCard } from '@/components/NewsCard';
import { Countdown } from '@/components/Countdown';
import { Crest } from '@/components/Crest';
import { formatKickoff } from '@/lib/site/format';

export const revalidate = 300;

export default async function Home() {
  const now = new Date();
  const [news, live, upcoming, seasons] = await Promise.all([
    getTrendingNews(7),
    getLiveAndRecent(now),
    getUpcoming(now, 6),
    getNextKickoffPerLeague(now),
  ]);

  const [lead, ...rest] = news;
  const pending = seasons.filter((s) => s.kickoffUtc !== null);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <section className="space-y-4">
          {lead ? <NewsCard item={lead} now={now} lead /> : (
            <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
              No headlines yet — the news job runs every 15 minutes.
            </div>
          )}
        </section>

        {live.length > 0 ? (
          <LiveScores key="home" initial={live} nowIso={now.toISOString()} />
        ) : (
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              Season kicks off
            </h2>
            <ul className="space-y-2">
              {pending.map(({ league, kickoffUtc }) => (
                <li key={league.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-b-0 last:pb-0">
                  <span className="truncate text-sm font-medium">{league.name}</span>
                  <Countdown targetIso={kickoffUtc!} now={now} />
                </li>
              ))}
              {pending.length === 0 && <li className="text-sm text-muted">No fixtures scheduled.</li>}
            </ul>
          </section>
        )}
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Next fixtures</h2>
          <Link href="/calendar" className="text-[11px] text-muted hover:text-text">Full calendar →</Link>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
                {formatKickoff(f.kickoff_utc, now)}
              </p>
              <p className="flex items-center gap-2 text-sm"><Crest team={f.home} size={18} />{f.home?.short_name ?? f.home?.name}</p>
              <p className="mt-1 flex items-center gap-2 text-sm"><Crest team={f.away} size={18} />{f.away?.short_name ?? f.away?.name}</p>
            </li>
          ))}
          {upcoming.length === 0 && <li className="text-sm text-muted">Nothing scheduled.</li>}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((n) => <NewsCard key={n.id} item={n} now={now} />)}
      </section>

      <section className="rounded-xl border border-dashed border-border p-6">
        <h2 className="text-sm font-bold">Fantasy — coming soon</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Pick a squad from across the top five leagues, score points on real results, and run a
          league against your friends. In development.
        </p>
      </section>
    </div>
  );
}
