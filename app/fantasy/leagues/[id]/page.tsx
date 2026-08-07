import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getFantasyCalendar, getFantasySeason, isMissingTable } from '@/lib/site/queries/fantasy';
import { getLeague, getLeagueScoringData } from '@/lib/fantasy/leagueStore';
import { leaveLeagueAction } from '@/lib/fantasy/leagueActions';
import { rankLeague, scoreSeason, type LeagueEntry } from '@/lib/fantasy/standings';
import { FantasyShell } from '@/components/FantasyShell';
import { BoardPanel } from '@/components/BoardPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: 'Leagues — Touchline Fantasy' };
  try {
    const league = await getLeague(session.accessToken, id);
    return { title: league ? `${league.name} — Touchline Fantasy` : 'League not found — Touchline Fantasy' };
  } catch {
    return { title: 'Leagues — Touchline Fantasy' };
  }
}

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/fantasy/sign-in');

  let league;
  try {
    league = await getLeague(session.accessToken, id);
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) redirect('/fantasy/leagues');
    throw err;
  }
  // Null covers both "no such league" and "not a member": the policies in
  // 0009 return no rows either way, and telling the two apart out loud would
  // confirm which league ids exist.
  if (!league) notFound();

  const season = (await getFantasySeason()) ?? league.season;
  const [{ members, gameweeks, positions }, calendar] = await Promise.all([
    getLeagueScoringData(session.accessToken, id, season),
    getFantasyCalendar(season),
  ]);

  const entries: LeagueEntry[] = members.map((member) => ({
    userId: member.userId,
    squadName: member.squadName,
    score: member.generations.length > 0 ? scoreSeason(member.generations, gameweeks, { positions }) : null,
  }));

  // The most recent gameweek anybody has been scored for — the column a
  // manager checks first. Null before a ball is kicked.
  const latestGameweek = gameweeks.length > 0 ? Math.max(...gameweeks.map((g) => g.gameweek)) : null;
  const latestName = latestGameweek === null
    ? null
    : calendar.find((g) => g.gameweek === latestGameweek)?.name ?? `Gameweek ${latestGameweek}`;
  const provisional = entries.some((e) => (e.score?.pending ?? 0) > 0);

  const table = rankLeague(entries, latestGameweek);

  return (
    <FantasyShell email={session.email} current="leagues">
      <div className="space-y-3">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2">
          <h2 className="font-display text-18 font-extrabold tracking-[-0.01em]">{league.name}</h2>
          <p className="text-11 text-muted">
            {league.memberCount} {league.memberCount === 1 ? 'manager' : 'managers'}
          </p>
          <p className="text-11 text-muted">
            Join code <span className="font-mono tracking-[0.12em] text-text">{league.joinCode}</span>
          </p>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/fantasy/leagues" className="text-11 text-muted hover:text-text">
              All leagues
            </Link>
            <form action={leaveLeagueAction}>
              <input type="hidden" name="leagueId" value={league.id} />
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-0.5 text-11 font-semibold text-muted hover:text-text"
              >
                {/* An owner leaving does not delete the league — the other
                    managers keep playing. Said as "Leave" for everyone
                    because that is what it does. */}
                Leave
              </button>
            </form>
          </div>
        </header>

        <BoardPanel
          label="Table"
          meta={latestName ? `after ${latestName}` : 'no gameweeks scored yet'}
        >
          {table.length === 0 ? (
            <p className="px-3 py-5 text-13 text-muted">Nobody has joined this league yet.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* Narrow enough that the Total column — the one everybody
                  actually looks at — is on screen at 360px rather than past
                  the right edge of a scroller. The squad name is the only
                  elastic column, and it truncates. */}
              <table className="w-full min-w-[17rem] border-collapse text-13">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-11 uppercase tracking-wider text-muted">
                    <th scope="col" className="w-8 px-2 py-1.5 text-left font-semibold">#</th>
                    <th scope="col" className="px-2 py-1.5 text-left font-semibold">Squad</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                      {latestName ? `GW${latestGameweek}` : 'GW'}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => {
                    const isMe = row.userId === session.userId;
                    return (
                      <tr key={row.userId} className="border-b border-border last:border-b-0">
                        <td className="px-2 py-1.5 font-mono tabular-nums text-muted">{row.rank}</td>
                        <td className="max-w-0 px-2 py-1.5">
                          {/* The name truncates; "(you)" does not. Letting
                              the marker be the first thing cut would hide
                              exactly the row a manager opened the page to
                              find — and it is a marker rather than only bold
                              weight because weight alone is invisible to
                              anyone who cannot compare two rows of text. */}
                          <span className="flex items-baseline gap-1.5">
                            <span className={`truncate ${isMe ? 'font-semibold' : ''}`}>{row.squadName}</span>
                            {isMe && <span className="shrink-0 text-11 text-muted">(you)</span>}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {row.latest ?? <span className="text-muted">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">{row.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {provisional && (
            <p className="border-t border-border px-3 py-2 text-11 text-muted">
              Some scores are still being published by the Premier League, so these totals can
              still move.
            </p>
          )}
        </BoardPanel>

        {gameweeks.length === 0 && table.length > 0 && (
          <p className="px-1 text-13 text-muted">
            No gameweek has been scored yet. Totals appear once the first deadline passes and the
            results land.
          </p>
        )}
      </div>
    </FantasyShell>
  );
}
