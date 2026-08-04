import { Countdown } from '@/components/Countdown';
import { getCompetitionMeta } from '@/lib/site/competition';
import { scoreCellText } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams, LeagueRow } from '@/lib/site/rows';

export interface PendingKickoff {
  league: LeagueRow;
  kickoffUtc: string;
}

/**
 * The landing page's single-line ticker strip, above the hero. Two modes,
 * chosen by which data is non-empty rather than by a literal "is the season
 * live" flag (there is no such flag — `getLiveAndRecent` returning nothing
 * is what preseason *is*, and it's also what a live-but-goalless midweek gap
 * would look like once the season is under way):
 *
 * - `live.length > 0`: one item per live/recent fixture, mono score.
 * - otherwise: one item per league with a still-to-come kickoff, mono
 *   countdown — the preseason state, and the sane fallback the rest of the
 *   time too.
 *
 * `overflow-x-auto` + a `min-w-max` flex row (never `flex-wrap`) is what
 * makes this "horizontally scrollable, never wrapping" per the spec, at any
 * viewport down to 360px.
 */
export function Ticker({
  live, pending, leagues, now,
}: {
  live: FixtureWithTeams[];
  pending: PendingKickoff[];
  leagues: LeagueRow[];
  now: Date;
}) {
  if (live.length === 0 && pending.length === 0) return null;

  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  return (
    <div className="overflow-x-auto border-b border-border" aria-label={live.length > 0 ? 'Live scores' : 'Season countdown by competition'}>
      <ul className="flex min-w-max items-center gap-5 whitespace-nowrap px-1 py-2">
        {live.length > 0 && live.map((f) => {
          const league = leagueById.get(f.league_id);
          const comp = getCompetitionMeta(league?.fd_code ?? '');
          return (
            <li key={f.id} className="flex shrink-0 items-center gap-2 text-13">
              <span className={`size-1.5 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
              <span className="sr-only">{comp.name}</span>
              <span className="font-mono font-semibold tabular-nums">
                {f.home?.short_name ?? f.home?.name ?? 'TBC'} {scoreCellText(f, now)} {f.away?.short_name ?? f.away?.name ?? 'TBC'}
              </span>
            </li>
          );
        })}
        {live.length === 0 && pending.map(({ league, kickoffUtc }) => {
          const comp = getCompetitionMeta(league.fd_code);
          return (
            <li key={league.id} className="flex shrink-0 items-center gap-2 text-13">
              <span className={`size-1.5 shrink-0 rounded-full ${comp.bgClass}`} aria-hidden="true" />
              <span className="font-semibold">{league.name}</span>
              <Countdown targetIso={kickoffUtc} now={now} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
