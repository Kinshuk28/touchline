import { memo } from 'react';
import Link from 'next/link';
import { Crest } from '@/components/Crest';
import { stateLabel } from '@/lib/site/scoreDisplay';
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

// `scoreText` is computed by the caller (via `scoreDisplay.ts#scoreCellText`)
// rather than taking a raw `now: Date` here. `now` changes identity on every
// render of the caller, which would defeat `React.memo` below for every row
// regardless of whether that row's own data changed; a `now`-derived *string*
// stays reference- and value-stable for a fixture whose score/state haven't
// moved (scoreCellText only actually consults `now` for a fixture with no
// score yet, which live/recent fixtures always have). See lib/site/livePatch.ts.
function ScoreRowImpl({ fixture, scoreText }: { fixture: FixtureWithTeams; scoreText: string }) {
  const state = stateLabel(fixture);

  return (
    <li
      data-fixture-id={fixture.id}
      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
    >
      <Side team={fixture.home} />

      <span className="shrink-0 text-center text-sm font-bold tabular-nums" data-role="score">
        {scoreText}
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

export const ScoreRow = memo(ScoreRowImpl);
