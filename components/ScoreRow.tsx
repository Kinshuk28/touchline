import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { scoreCellText, stateLabel } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams } from '@/lib/site/rows';

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
  const state = stateLabel(fixture);

  return (
    <li
      data-fixture-id={fixture.id}
      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
    >
      <Side team={fixture.home} />

      <span className="shrink-0 text-center text-sm font-bold tabular-nums" data-role="score">
        {scoreCellText(fixture, now)}
      </span>

      <Side team={fixture.away} />

      <span
        className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-wide"
        data-role="state"
      >
        {state?.live && (
          <span className="inline-flex items-center gap-1 text-live">
            <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
            Live
          </span>
        )}
        {state && !state.live && <span className="text-muted">{state.text}</span>}
      </span>
    </li>
  );
}
