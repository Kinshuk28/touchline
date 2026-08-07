import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import {
  getPlayerPool,
  getSeasonPoints,
  getFantasyCalendar,
  getFantasySeason,
  isMissingTable,
  type PoolPlayer,
  type Gameweek,
} from '@/lib/site/queries/fantasy';
import { getSquadForGameweek } from '@/lib/fantasy/squadStore';
import { openGameweek, timeUntilDeadline } from '@/lib/fantasy/gameweekWindow';
import { STARTING_SLOTS } from '@/lib/fantasy/squadRules';
import { SquadPicker, type PickerInitial } from '@/components/SquadPicker';
import { FantasyShell } from '@/components/FantasyShell';
import { BoardPanel } from '@/components/BoardPanel';

export const metadata: Metadata = {
  title: 'Fantasy — pick your squad — Touchline',
  description: 'Pick fifteen Premier League players and score them on real gameweek results.',
};

// A session cookie decides everything on this page. Never prerendered,
// never cached.
export const dynamic = 'force-dynamic';

export default async function FantasyPage() {
  const session = await getSession();
  if (!session) redirect('/fantasy/sign-in');

  const season = await getFantasySeasonSafely();
  if (season === 'unavailable') return <NotSetUpYet email={session.email} />;
  if (season === null) {
    return (
      <FantasyShell email={session.email} current="squad">
        <p className="px-3 py-6 text-13 text-muted">
          No Premier League season is set up yet. The fantasy game opens once the season
          is loaded.
        </p>
      </FantasyShell>
    );
  }

  let pool: PoolPlayer[];
  let calendar: Gameweek[];
  let points: Map<number, number>;
  try {
    [pool, calendar, points] = await Promise.all([
      getPlayerPool(season),
      getFantasyCalendar(season),
      getSeasonPoints(season),
    ]);
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) {
      return <NotSetUpYet email={session.email} />;
    }
    throw err;
  }

  if (pool.length === 0) {
    return (
      <FantasyShell email={session.email} current="squad">
        <p className="px-3 py-6 text-13 text-muted">
          No players are priced for {season} yet. The fantasy ingest job publishes the pool
          from FPL — until it has run once, there is nothing to pick from.
        </p>
      </FantasyShell>
    );
  }

  // Points are a separate read with a different lifetime, joined here rather
  // than in the query: a squad can be picked perfectly well before a ball is
  // kicked, when this map is empty.
  const priced = pool.map((p) => ({ ...p, seasonPoints: points.get(p.playerId) ?? null }));

  const now = new Date();
  const gameweek = openGameweek(calendar, now);
  const gameweekRow = gameweek === null ? null : calendar.find((g) => g.gameweek === gameweek) ?? null;
  const remaining = gameweekRow ? timeUntilDeadline(gameweekRow.deadlineUtc, now) : null;
  const gameweekLabel = gameweekRow
    ? `${gameweekRow.name}${remaining && remaining !== 'closed' ? ` — deadline in ${remaining}` : ''}`
    : 'The season is over — nothing left to pick for.';

  // The side already saved for the gameweek being picked. Falls back to the
  // most recent generation, which is what `getSquadForGameweek` returns when
  // no save exists for this week yet.
  const existing = gameweek === null ? null : await getSquadForGameweek(session.accessToken, session.userId, season, gameweek);
  const initial: PickerInitial | null = existing && existing.picks.length > 0
    ? {
      name: existing.name,
      starters: existing.picks.filter((p) => p.slot <= STARTING_SLOTS).sort((a, b) => a.slot - b.slot).map((p) => p.playerId),
      bench: existing.picks.filter((p) => p.slot > STARTING_SLOTS).sort((a, b) => a.slot - b.slot).map((p) => p.playerId),
      captainId: existing.picks.find((p) => p.isCaptain)?.playerId ?? null,
      viceCaptainId: existing.picks.find((p) => p.isViceCaptain)?.playerId ?? null,
    }
    : null;

  return (
    <FantasyShell email={session.email} current="squad">
      <SquadPicker pool={priced} initial={initial} gameweekLabel={gameweekLabel} />
    </FantasyShell>
  );
}

/**
 * The state between this code deploying and the project owner applying
 * supabase/migrations/0006-0008 by hand. Said plainly, the same way /status
 * handles its own unapplied migration, rather than surfacing a 500 to
 * someone who has just signed in.
 */
function NotSetUpYet({ email }: { email: string | null }) {
  return (
    <FantasyShell email={email} current="squad">
      <BoardPanel label="Not ready yet" meta="Setup">
        <div className="space-y-2 px-3 py-4 text-13 text-muted">
          <p>
            The fantasy tables have not been created in the database yet, so there is nothing
            to pick from. Everything else on the site is unaffected.
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

/**
 * `getFantasySeason` reads `leagues`, which has existed since 0001 — but this
 * page is the first thing a signed-in manager sees, and a missing-table error
 * anywhere in the chain should produce the setup notice rather than a stack
 * trace.
 */
async function getFantasySeasonSafely(): Promise<number | null | 'unavailable'> {
  try {
    return await getFantasySeason();
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) return 'unavailable';
    throw err;
  }
}
