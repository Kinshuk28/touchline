import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFixtureById } from '@/lib/site/queries/fixtures';
import { getLeagues } from '@/lib/site/queries/leagues';
import { getGoalsForFixture } from '@/lib/site/queries/fixtureGoals';
import { getCompetitionMeta } from '@/lib/site/competition';
import { formatKickoffTime } from '@/lib/site/format';
import { spineRowKind, spineStateLabel } from '@/lib/site/spine';
import { Crest } from '@/components/Crest';
import { BoardPanel } from '@/components/BoardPanel';

/*
 * /match/[id] — a fixture's own page: full score detail (including
 * half-time, already stored but never shown anywhere else), kickoff time,
 * venue and matchday, plus who scored when that detail is on file. Linked
 * to from every fixture row (ScoreRow, MatchdaySpine) so a result is never
 * a dead end.
 */

export const revalidate = 300;

async function loadFixture(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();
  const fixture = await getFixtureById(id);
  if (!fixture) notFound();
  return fixture;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed)) return { title: 'Match not found — Touchline' };
  const fixture = await getFixtureById(parsed);
  if (!fixture) return { title: 'Match not found — Touchline' };
  const home = fixture.home?.name ?? 'TBC';
  const away = fixture.away?.name ?? 'TBC';
  return {
    title: `${home} v ${away} — Touchline`,
    description: `Kickoff time, score and goal detail for ${home} v ${away}.`,
  };
}

function GoalLine({ goal, teamName }: { goal: { minute: number | null; scorer_name: string; assist_name: string | null; type: string | null }; teamName: string }) {
  return (
    <li className="flex items-center gap-2 border-b border-border px-3 py-2 text-14 last:border-b-0">
      <span className="w-10 shrink-0 font-mono text-13 tabular-nums text-muted">
        {goal.minute !== null ? `${goal.minute}'` : ''}
      </span>
      <span className="min-w-0 flex-1">
        {/* The (pen.)/(og) qualifier sits on its own line, same as the
            assist below it — inline after a long scorer name was wrapping
            awkwardly on narrow screens (verified at 375px), forcing the
            team-name column beside it out of vertical centre. */}
        <span className="font-medium">{goal.scorer_name}</span>
        {goal.type === 'PENALTY' && <span className="block text-13 text-muted">Penalty</span>}
        {goal.type === 'OWN' && <span className="block text-13 text-muted">Own goal</span>}
        {goal.assist_name && <span className="block text-13 text-muted">assist: {goal.assist_name}</span>}
      </span>
      <span className="shrink-0 truncate text-13 text-muted">{teamName}</span>
    </li>
  );
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixture = await loadFixture(id);
  const now = new Date();

  const [leagues, goals] = await Promise.all([
    getLeagues(),
    getGoalsForFixture(fixture.id),
  ]);
  const league = leagues.find((l) => l.id === fixture.league_id) ?? null;
  const comp = getCompetitionMeta(league?.fd_code ?? '');

  const kind = spineRowKind(fixture);
  const state = spineStateLabel(fixture);
  const hasScore = fixture.home_goals !== null && fixture.away_goals !== null;

  const homeName = fixture.home?.name ?? 'TBC';
  const awayName = fixture.away?.name ?? 'TBC';
  const venue = fixture.home?.venue ?? null;

  const teamNameById = new Map(
    [fixture.home, fixture.away].filter((t): t is NonNullable<typeof t> => t !== null).map((t) => [t.id, t.name]),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/scores" className="text-13 text-muted hover:text-text">← Back to scores</Link>
      </div>

      <div className="cyber-cut overflow-hidden border border-comp-pl/20 border-t-2 border-t-comp-pl bg-surface/80">
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2">
          <span className={`h-3 w-1 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
          <span className={`font-mono text-11 font-semibold uppercase tracking-wider ${comp.textClass}`}>{comp.name}</span>
          {fixture.matchday !== null && (
            <span className="font-mono text-11 uppercase tracking-wider text-muted">Matchday {fixture.matchday}</span>
          )}
          {state && (
            <span className={`ml-auto font-mono text-11 font-semibold uppercase tracking-wide ${state.live ? 'text-live' : 'text-muted'}`}>
              {state.live && <span className="tl-live-dot mr-1 inline-block size-1.5 rounded-full bg-live" aria-hidden="true" />}
              {state.text}
            </span>
          )}
        </header>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-6 sm:gap-6 sm:px-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <Crest team={fixture.home} size={56} eager />
            {fixture.home ? (
              <Link href={`/team/${fixture.home.slug}`} className="text-15 font-semibold hover:underline sm:text-18">
                {homeName}
              </Link>
            ) : (
              <span className="text-15 font-semibold sm:text-18">{homeName}</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-32 font-extrabold tabular-nums sm:text-44">
              {hasScore ? `${fixture.home_goals}–${fixture.away_goals}` : '—'}
            </span>
            {hasScore && fixture.half_time_home !== null && fixture.half_time_away !== null && (
              <span className="font-mono text-13 text-muted">HT {fixture.half_time_home}–{fixture.half_time_away}</span>
            )}
            {!hasScore && kind === 'upcoming' && (
              <span className="font-mono text-13 text-muted">{formatKickoffTime(fixture.kickoff_utc, now)} IST</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 text-center">
            <Crest team={fixture.away} size={56} eager />
            {fixture.away ? (
              <Link href={`/team/${fixture.away.slug}`} className="text-15 font-semibold hover:underline sm:text-18">
                {awayName}
              </Link>
            ) : (
              <span className="text-15 font-semibold sm:text-18">{awayName}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-13 text-muted">
          <span>{formatKickoffTime(fixture.kickoff_utc, now, { dateContext: false })} IST</span>
          {venue && <span>{venue}</span>}
        </div>
      </div>

      {goals.length > 0 && (
        <BoardPanel label="Goals" order={1}>
          <ul>
            {goals.map((g) => (
              <GoalLine
                key={g.id}
                goal={g}
                teamName={g.team_id !== null ? teamNameById.get(g.team_id) ?? '' : ''}
              />
            ))}
          </ul>
        </BoardPanel>
      )}
    </div>
  );
}
