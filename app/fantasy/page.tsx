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
import {
  getSquadForGameweek,
  getSquadId,
  getTransferHistory,
  getChipsPlayed,
  getChipForGameweek,
} from '@/lib/fantasy/squadStore';
import { transferAllowance } from '@/lib/fantasy/transfers';
import { availableChips, type Chip } from '@/lib/fantasy/chips';
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
  // `existing` is the side to edit; `locked` is the side that finished last
  // gameweek, which is what transfers are counted against. See the note in
  // lib/fantasy/pickerActions.ts — after one save these differ, and using
  // the wrong one undercharges a manager who saves twice before a deadline.
  const existing = gameweek === null ? null : await getSquadForGameweek(session.accessToken, session.userId, season, gameweek);
  const locked = gameweek === null || gameweek <= 1
    ? null
    : await getSquadForGameweek(session.accessToken, session.userId, season, gameweek - 1);
  const initial: PickerInitial | null = existing && existing.picks.length > 0
    ? {
      name: existing.name,
      starters: existing.picks.filter((p) => p.slot <= STARTING_SLOTS).sort((a, b) => a.slot - b.slot).map((p) => p.playerId),
      bench: existing.picks.filter((p) => p.slot > STARTING_SLOTS).sort((a, b) => a.slot - b.slot).map((p) => p.playerId),
      captainId: existing.picks.find((p) => p.isCaptain)?.playerId ?? null,
      viceCaptainId: existing.picks.find((p) => p.isViceCaptain)?.playerId ?? null,
    }
    : null;

  // A player already owned keeps what they cost; only a new arrival pays
  // today's price. Applied to the whole pool so the picker's budget
  // arithmetic is the same arithmetic the server will redo on save — a
  // picker that says a squad is affordable and a save that disagrees is
  // worse than either rule on its own. See lib/fantasy/pickerActions.ts.
  const paid = new Map(
    (existing?.picks ?? []).flatMap((p) => (p.priceTenths === null ? [] : [[p.playerId, p.priceTenths] as const])),
  );
  const priced = pool.map((p) => ({
    ...p,
    priceTenths: paid.get(p.playerId) ?? p.priceTenths,
    seasonPoints: points.get(p.playerId) ?? null,
  }));

  // How many changes are free this gameweek. `null` means unlimited, which is
  // the state until a first side has been locked in.
  const squadId = await getSquadId(session.accessToken, session.userId, season);
  const history = squadId === null ? [] : await getTransferHistory(session.accessToken, squadId);
  const allowance = gameweek === null ? null : transferAllowance(history, gameweek);

  const [chipsPlayed, chipThisWeek, chipLastWeek] = squadId === null || gameweek === null
    ? [[], null, null]
    : await Promise.all([
      getChipsPlayed(session.accessToken, squadId),
      getChipForGameweek(session.accessToken, squadId, gameweek),
      gameweek > 1 ? getChipForGameweek(session.accessToken, squadId, gameweek - 1) : Promise.resolve(null),
    ]);

  // The week after a Free Hit, the side that counts as "what you had" is the
  // one from before the Free Hit, not the borrowed eleven. Counting transfers
  // against the borrowed side would bill a manager for giving back a team
  // they were never keeping. The server action does the same — see
  // lib/fantasy/pickerActions.ts.
  const baseline = chipLastWeek === 'free-hit' && gameweek !== null && gameweek > 2
    ? await getSquadForGameweek(session.accessToken, session.userId, season, gameweek - 2)
    : locked;

  return (
    <FantasyShell email={session.email} current="squad">
      <SquadPicker
        pool={priced}
        initial={initial}
        gameweekLabel={gameweekLabel}
        previousIds={baseline?.picks.map((p) => p.playerId) ?? []}
        freeTransfers={allowance === null || allowance.unlimited ? null : allowance.free}
        chipOptions={gameweek === null ? [] : availableChips(chipsPlayed, gameweek)}
        initialChip={chipThisWeek as Chip | null}
      />
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
