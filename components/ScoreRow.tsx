import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { formatKickoff } from '@/lib/site/format';
import type { FixtureWithTeams } from '@/lib/site/rows';

const LIVE = new Set(['IN_PLAY', 'PAUSED']);
const PLAYED = new Set(['FINISHED', 'AWARDED']);
const DEAD = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED']);

function Side({ team }: { team: FixtureWithTeams['home'] }) {
  const label = team?.short_name ?? team?.name ?? 'TBC';
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <Crest team={team} size={22} />
      <span className="truncate text-sm font-medium">{label}</span>
    </span>
  );
  return team ? <Link href={`/team/${team.slug}`} className="min-w-0 flex-1 hover:underline">{body}</Link>
              : <span className="min-w-0 flex-1">{body}</span>;
}

export function ScoreRow({ fixture, now }: { fixture: FixtureWithTeams; now: Date }) {
  const live = LIVE.has(fixture.status);
  const played = PLAYED.has(fixture.status);
  const dead = DEAD.has(fixture.status);
  const hasScore = fixture.home_goals !== null && fixture.away_goals !== null;

  return (
    <li
      data-fixture-id={fixture.id}
      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
    >
      <Side team={fixture.home} />

      <span className="shrink-0 text-center text-sm font-bold tabular-nums" data-role="score">
        {hasScore ? `${fixture.home_goals}–${fixture.away_goals}`
                  : dead ? '—'
                  : formatKickoff(fixture.kickoff_utc, now)}
      </span>

      <Side team={fixture.away} />

      <span className="w-16 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide" data-role="state">
        {live && (
          <span className="inline-flex items-center gap-1 text-live">
            <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
            Live
          </span>
        )}
        {!live && dead && <span className="text-muted">{fixture.status === 'POSTPONED' ? 'Postponed' : 'Off'}</span>}
        {!live && played && <span className="text-muted">FT</span>}
      </span>
    </li>
  );
}
