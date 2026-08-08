import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getFantasySeason, isMissingTable } from '@/lib/site/queries/fantasy';
import { getSquadId, getSeasonScore } from '@/lib/fantasy/squadStore';
import { FantasyShell } from '@/components/FantasyShell';
import { BoardPanel } from '@/components/BoardPanel';
import { ChipBadge } from '@/components/fantasy/badges';
import { GameweekPointsChart } from '@/components/fantasy/charts';

export const metadata: Metadata = {
  title: 'History — Touchline Fantasy',
  description: 'Your fantasy squad, gameweek by gameweek: points, chips and transfer costs across the season.',
};

// A session cookie decides everything here. Never prerendered, never cached.
export const dynamic = 'force-dynamic';

/**
 * The gameweek-by-gameweek breakdown the spec's own "Still open" section
 * named as the natural next step once the game had a season's worth of
 * results to show: `MyFantasyPanel` and the squad page's own "Your season"
 * chart already draw the same bars, but a bar chart's tooltip is the only
 * place the exact numbers — the chip played, the transfer hit, how many
 * picks are still provisional — ever appeared. This page is that table.
 *
 * No new query: `getSeasonScore` (lib/fantasy/squadStore.ts) already returns
 * every `GameweekResult` a league table scores from. This page is a second,
 * fuller view of data the picker and the landing panel already fetch —
 * never a new source of truth for what a manager scored.
 */
export default async function FantasyHistoryPage() {
  const session = await getSession();
  if (!session) redirect('/fantasy/sign-in');

  let season: number | null;
  try {
    season = await getFantasySeason();
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) {
      return <NotSetUpYet email={session.email} />;
    }
    throw err;
  }
  if (season === null) {
    return (
      <FantasyShell email={session.email} current="history">
        <p className="px-3 py-6 text-13 text-muted">
          No Premier League season is set up yet. The fantasy game opens once the season is
          loaded.
        </p>
      </FantasyShell>
    );
  }

  const squadId = await getSquadId(session.accessToken, session.userId, season);
  if (squadId === null) {
    return (
      <FantasyShell email={session.email} current="history">
        <BoardPanel label="No squad yet" meta="History">
          <div className="space-y-2 px-3 py-4 text-13 text-muted">
            <p>Pick a squad first — there is nothing to show a history of until you have.</p>
            <p>
              <Link href="/fantasy" className="underline hover:text-text">Pick your squad →</Link>
            </p>
          </div>
        </BoardPanel>
      </FantasyShell>
    );
  }

  const score = await getSeasonScore(session.accessToken, session.userId, season);
  const gameweeks = score?.gameweeks ?? [];

  return (
    <FantasyShell email={session.email} current="history">
      {gameweeks.length === 0 ? (
        <BoardPanel label={score?.squadName ?? 'Your season'} meta="History">
          <p className="px-3 py-6 text-13 text-muted">
            No gameweek has been scored yet. This page fills in once the first deadline passes
            and the results land.
          </p>
        </BoardPanel>
      ) : (
        <>
          <BoardPanel label={score!.squadName} meta={`${score!.total} pts total`}>
            <GameweekPointsChart gameweeks={gameweeks} />
          </BoardPanel>

          <BoardPanel label="Gameweek by gameweek" meta={`${gameweeks.length} scored`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] border-collapse text-13">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-11 uppercase tracking-wider text-muted">
                    <th scope="col" className="w-14 px-2 py-1.5 text-left font-semibold">GW</th>
                    <th scope="col" className="px-2 py-1.5 text-left font-semibold">Chip</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">Points</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">Cost</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...gameweeks].reverse().map((g) => (
                    <tr key={g.gameweek} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-1.5 font-mono tabular-nums text-muted">{g.gameweek}</td>
                      <td className="px-2 py-1.5">
                        {g.chip ? <ChipBadge chip={g.chip} /> : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {g.points}
                        {/* Missing is not zero — see lib/fantasy/standings.ts. A
                            week with picks still awaiting a published score says
                            so beside the number, rather than letting a total
                            that's still moving read as final. */}
                        {g.pending > 0 && (
                          <span className="ml-1 text-11 text-muted">
                            ({g.pending} pending)
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                        {g.transferCost > 0 ? `-${g.transferCost}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">{g.net}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {score!.pending > 0 && (
              <p className="border-t border-border px-3 py-2 text-11 text-muted">
                Some scores are still being published by the Premier League, so this season's
                total can still move.
              </p>
            )}
          </BoardPanel>
        </>
      )}
    </FantasyShell>
  );
}

/**
 * The state between this code deploying and the project owner applying the
 * fantasy migrations by hand — same notice `app/fantasy/page.tsx` shows,
 * repeated here because this route can be reached directly (a bookmark, a
 * shared link) without ever passing through that page first.
 */
function NotSetUpYet({ email }: { email: string | null }) {
  return (
    <FantasyShell email={email} current="history">
      <BoardPanel label="Not ready yet" meta="Setup">
        <div className="space-y-2 px-3 py-4 text-13 text-muted">
          <p>
            The fantasy tables have not been created in the database yet, so there is nothing
            to show a history of. Everything else on the site is unaffected.
          </p>
          <p>
            <Link href="/status" className="underline hover:text-text">Job status</Link>
            {' · '}
            <Link href="/" className="underline hover:text-text">Back to the scores</Link>
          </p>
        </div>
      </BoardPanel>
    </FantasyShell>
  );
}
