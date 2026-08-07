import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { getFantasySeason, isMissingTable } from '@/lib/site/queries/fantasy';
import { getMyLeagues, type LeagueSummary } from '@/lib/fantasy/leagueStore';
import { FantasyShell } from '@/components/FantasyShell';
import { CreateLeagueForm, JoinLeagueForm } from '@/components/LeagueForms';
import { BoardPanel } from '@/components/BoardPanel';

export const metadata: Metadata = {
  title: 'Leagues — Touchline Fantasy',
  description: 'Run a fantasy league against your friends.',
};

export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const session = await getSession();
  if (!session) redirect('/fantasy/sign-in');

  let leagues: LeagueSummary[] = [];
  let unavailable = false;
  try {
    const season = await getFantasySeason();
    if (season !== null) leagues = await getMyLeagues(session.accessToken, season);
  } catch (err) {
    // supabase/migrations/0009 is applied by hand. Until it is, this page
    // says so instead of failing — the same treatment the picker gives its
    // own unapplied migrations.
    if (!isMissingTable(err instanceof Error ? err.message : String(err))) throw err;
    unavailable = true;
  }

  return (
    <FantasyShell email={session.email} current="leagues">
      {unavailable ? (
        <BoardPanel label="Not ready yet" meta="Setup">
          <p className="px-3 py-4 text-13 text-muted">
            Leagues have not been created in the database yet. Your squad is unaffected.
          </p>
        </BoardPanel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
          <BoardPanel
            label="Your leagues"
            meta={leagues.length > 0 ? `${leagues.length}` : undefined}
          >
            {leagues.length === 0 ? (
              <p className="px-3 py-5 text-13 text-muted">
                You are not in a league yet. Start one and send the code to whoever you want to
                beat, or join theirs.
              </p>
            ) : (
              <ul>
                {leagues.map((league) => (
                  <li key={league.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/fantasy/leagues/${league.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-15 font-semibold">{league.name}</span>
                      {league.ownerId === session.userId && (
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-11 uppercase tracking-wider text-muted">
                          Yours
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-11 tabular-nums text-muted">
                        {league.memberCount} {league.memberCount === 1 ? 'manager' : 'managers'}
                      </span>
                      <span className="shrink-0 font-mono text-11 tracking-[0.12em] text-muted">
                        {league.joinCode}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </BoardPanel>

          <div className="space-y-3">
            <BoardPanel label="Start or join">
              <div className="space-y-4 p-3">
                <CreateLeagueForm />
                <div className="border-t border-border pt-4">
                  <JoinLeagueForm />
                </div>
              </div>
            </BoardPanel>

            <BoardPanel label="How leagues work">
              <ul className="space-y-1.5 px-3 py-3 text-13 text-muted">
                <li>· Every league has a code. Anyone with it can join; nobody else can even see it exists.</li>
                <li>· Managers are scored on the side they had picked at the time, gameweek by gameweek.</li>
                <li>
                  · You can see a rival&rsquo;s team only after that gameweek&rsquo;s deadline has passed —
                  before it, their picks are theirs.
                </li>
              </ul>
            </BoardPanel>
          </div>
        </div>
      )}
    </FantasyShell>
  );
}
