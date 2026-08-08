import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import {
  getFantasySeason,
  getFantasyCalendar,
  getGameweekPerformers,
  isMissingTable,
  type GameweekPerformer,
} from '@/lib/site/queries/fantasy';
import { POSITIONS, POSITION_LABELS, formatPrice, type FantasyPosition } from '@/lib/fantasy/squadRules';
import { FantasyShell } from '@/components/FantasyShell';
import { BoardPanel } from '@/components/BoardPanel';
import { PositionBadge } from '@/components/fantasy/badges';

/*
 * The one fantasy page that needs no sign-in — who actually had a big
 * gameweek is public information the moment FPL publishes it, the same way
 * a matchday's scorers are public on /scores. Anyone can look, which also
 * means anyone can be shown what the game is before deciding to play it.
 *
 * Two audiences share this page: a signed-in manager gets it inside
 * FantasyShell, with Squad/Leagues/Stats as three tabs of one thing; a
 * visitor with no session gets a lighter header of its own — FantasyShell's
 * chrome assumes a session (it always renders a sign-out control), so it is
 * simply not the right wrapper for someone who isn't signed in at all.
 */

export const metadata: Metadata = {
  title: 'Fantasy stats — Touchline',
  description: "Top scorers and the best XI from the Premier League's most recent gameweek.",
};

export const dynamic = 'force-dynamic';

const BEST_PER_POSITION = 3;
const TOP_SCORERS = 15;

export default async function FantasyStatsPage() {
  const session = await getSession();

  const season = await getFantasySeasonSafely();
  if (season === 'unavailable' || season === null) {
    return <Frame session={session}><NotSetUpYet /></Frame>;
  }

  const calendar = await getFantasyCalendar(season);
  const finished = calendar.filter((g) => g.isFinal);
  const latest = finished.length > 0 ? finished[finished.length - 1] : undefined;

  if (latest === undefined) {
    return (
      <Frame session={session}>
        <BoardPanel label="Stats" meta="Season not under way">
          <p className="px-3 py-5 text-13 text-muted">
            No gameweek has finished yet — scores land here once the first set of matches
            is played and the Premier League's final numbers are in.
          </p>
        </BoardPanel>
      </Frame>
    );
  }

  let performers: GameweekPerformer[];
  try {
    performers = await getGameweekPerformers(season, latest.gameweek);
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) {
      return <Frame session={session}><NotSetUpYet /></Frame>;
    }
    throw err;
  }

  const byPosition = new Map<FantasyPosition, GameweekPerformer[]>(
    POSITIONS.map((pos) => [pos, performers.filter((p) => p.position === pos).slice(0, BEST_PER_POSITION)]),
  );

  return (
    <Frame session={session}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <BoardPanel label="Top scorers" meta={latest.name}>
          {performers.length === 0 ? (
            <p className="px-3 py-5 text-13 text-muted">
              No scores published for {latest.name} yet.
            </p>
          ) : (
            <ol>
              {performers.slice(0, TOP_SCORERS).map((p, i) => (
                <li
                  key={p.playerId}
                  className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
                >
                  <span className="w-4 shrink-0 font-mono text-11 tabular-nums text-muted">{i + 1}</span>
                  <PositionBadge position={p.position} />
                  <Link href={`/player/${p.slug}`} className="min-w-0 flex-1 truncate text-13 font-medium hover:text-comp-pd">
                    {p.name}
                  </Link>
                  <span className="shrink-0 font-mono text-11 text-muted">{p.teamTla ?? '—'}</span>
                  <span className="w-14 shrink-0 text-right font-mono text-13 tabular-nums text-muted">
                    {formatPrice(p.priceTenths)}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-15 font-bold tabular-nums text-comp-pd">
                    {p.points}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </BoardPanel>

        <BoardPanel label="Best by position" meta={latest.name}>
          {POSITIONS.map((pos) => {
            const rows = byPosition.get(pos) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={pos}>
                <p className="border-b border-border bg-surface-2/60 px-3 py-1 text-11 font-semibold uppercase tracking-wider text-muted">
                  {POSITION_LABELS[pos]}
                </p>
                <ul>
                  {rows.map((p) => (
                    <li key={p.playerId} className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                      <Link href={`/player/${p.slug}`} className="min-w-0 flex-1 truncate text-13 font-medium hover:text-comp-pd">
                        {p.name}
                      </Link>
                      <span className="shrink-0 font-mono text-11 text-muted">{p.teamTla ?? '—'}</span>
                      <span className="w-8 shrink-0 text-right font-mono text-13 font-bold tabular-nums text-comp-pd">
                        {p.points}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </BoardPanel>
      </div>
    </Frame>
  );
}

/**
 * The public/signed-in split described at the top of the file. `session`
 * being `null` means signed out — `session.email` being `null` is a
 * different, unrelated fact (a token whose claims happened not to carry an
 * email), and FantasyShell already handles that case fine on its own.
 */
function Frame({ session, children }: { session: { email: string | null } | null; children: React.ReactNode }) {
  return session !== null
    ? <FantasyShell email={session.email} current="stats">{children}</FantasyShell>
    : <PublicFrame>{children}</PublicFrame>;
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-comp-pl/40 bg-surface/80 px-3 py-2">
        <h1 className="font-display text-24 font-black uppercase tracking-[-0.01em] text-comp-pl drop-shadow-[0_0_10px_rgba(255,0,255,0.6)]">
          Fantasy
        </h1>
        <p className="text-11 font-semibold uppercase tracking-wider text-muted">Stats</p>
        <Link href="/fantasy/sign-in" className="ml-auto font-mono text-11 text-muted hover:text-comp-pd">
          Pick your own squad →
        </Link>
      </header>
      {children}
    </div>
  );
}

function NotSetUpYet() {
  return (
    <BoardPanel label="Not ready yet" meta="Setup">
      <div className="space-y-2 px-3 py-4 text-13 text-muted">
        <p>The fantasy tables have not been created in the database yet, so there is nothing to show.</p>
        <p>
          <Link href="/status" className="underline hover:text-text">Job status</Link>
          {' · '}
          <Link href="/" className="underline hover:text-text">Back to the scores</Link>
        </p>
      </div>
    </BoardPanel>
  );
}

async function getFantasySeasonSafely(): Promise<number | null | 'unavailable'> {
  try {
    return await getFantasySeason();
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) return 'unavailable';
    throw err;
  }
}
