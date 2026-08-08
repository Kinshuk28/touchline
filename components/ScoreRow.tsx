import { memo } from 'react';
import { Crest } from '@/components/Crest';
import { stateLabel } from '@/lib/site/scoreDisplay';
import type { FixtureWithTeams } from '@/lib/site/rows';

// Deliberately a plain <span>, never a <Link>: there is no `app/team/`
// route in Phase B1 (team pages arrive in Plan B2), so linking to
// `/team/${team.slug}` here was a guaranteed 404 on every home and away
// name across `/scores` and the landing live panel — and with no
// `app/not-found.tsx` at the time, users landed on Next's unstyled
// default 404. Reintroduce the `<Link>` only once `app/team/[slug]` exists.
//
// `align="end"` for the home side, mirroring the fixed-width,
// home-hugs-the-score layout `app/scores/page.tsx`'s `CompetitionGroup`
// already uses: without it, both sides were identically left-justified
// flex-1 boxes, so a short home name (e.g. "Arsenal") sat flush against
// the row's left edge with a ragged gap before the score, while a long one
// (e.g. "Crystal Palace") ran right up to it — the score read as landing at
// a different distance from the team name on every row. `sm:w-32
// sm:flex-none` pins both sides to the same width once there's room for it,
// so the score sits at one consistent x-position down the whole list;
// below `sm` it reverts to plain `flex-1`, same mobile compromise
// `CompetitionGroup` makes, since there isn't 2x128px to spare at 360px.
function Side({ team, align = 'start' }: { team: FixtureWithTeams['home']; align?: 'start' | 'end' }) {
  const label = team?.short_name ?? team?.name ?? 'TBC';
  const name = <span className="truncate text-sm font-medium">{label}</span>;
  return (
    <span
      className={`flex min-w-0 flex-1 items-center gap-2 sm:w-32 sm:flex-none ${
        align === 'end' ? 'justify-end text-right' : ''
      }`}
    >
      {align === 'end' && name}
      <Crest team={team} size={22} />
      {align !== 'end' && name}
    </span>
  );
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
      <Side team={fixture.home} align="end" />

      <span className="shrink-0 px-1 text-center text-sm font-bold tabular-nums" data-role="score">
        {scoreText}
      </span>

      <Side team={fixture.away} />

      <span
        className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-wide"
        data-role="state"
      >
        {state?.live && (
          <span className="inline-flex items-center gap-1 text-live">
            <span className="tl-live-dot size-1.5 rounded-full bg-live" aria-hidden="true" />
            Live
          </span>
        )}
        {state && !state.live && <span className="text-muted">{state.text}</span>}
      </span>
    </li>
  );
}

export const ScoreRow = memo(ScoreRowImpl);
