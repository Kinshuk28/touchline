import { Mark } from '@/components/Mark';
import { GameweekPointsChart } from '@/components/fantasy/charts';
import { Button } from '@/components/ui/Button';
import type { NamedSeasonScore } from '@/lib/fantasy/squadStore';

/**
 * The landing dashboard's Fantasy panel, for a signed-in manager who has
 * already picked a side — real data in the one place on the page that used
 * to be pure promotion (components/FantasyTeaser.tsx, still shown to
 * everyone else). A manager who checks in for ten seconds should see their
 * own season, not an advert for a feature they are already playing.
 */
export function MyFantasyPanel({ score }: { score: NamedSeasonScore }) {
  const latest = score.gameweeks.at(-1) ?? null;
  return (
    <section className="overflow-hidden border-2 border-comp-pd bg-black/80 shadow-[0_0_25px_rgba(0,255,255,0.15)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0 max-w-prose">
          <p className="flex items-center gap-2 text-11 font-bold uppercase tracking-[0.2em] text-comp-pl">
            <Mark size={14} />
            Your Fantasy squad
          </p>
          <h2 className="mt-2 truncate font-display text-24 font-black uppercase leading-tight tracking-[-0.01em] text-comp-pd drop-shadow-[0_0_10px_rgba(0,255,255,0.6)] sm:text-32">
            {score.squadName}
          </h2>
          <p className="mt-2 text-15 text-muted">
            {score.total} point{score.total === 1 ? '' : 's'} this season
            {latest && `, ${latest.net} in gameweek ${latest.gameweek}`}.
            {score.pending > 0 && ' Some scores are still being published by the Premier League.'}
          </p>
          <p className="mt-3">
            <Button href="/fantasy" size="sm">Manage your squad →</Button>
          </p>
        </div>

        {score.gameweeks.length > 0 && (
          <div className="w-full shrink-0 border-2 border-border bg-surface-2 sm:w-auto">
            <GameweekPointsChart gameweeks={score.gameweeks.slice(-8)} />
          </div>
        )}
      </div>
    </section>
  );
}
