import type { GameweekResult } from '@/lib/fantasy/standings';
import { formatPrice } from '@/lib/fantasy/squadRules';

/**
 * Small hand-rolled SVG charts for the fantasy pages — no charting library,
 * matching the rest of the site's "own every pixel, add no dependency" rule.
 * Both carry their data as text too (an `aria-label` naming every value, and
 * a `sr-only` caption): a chart that only a sighted mouse-hoverer can read
 * is worse than no chart, on a site with no third-party script to fall back
 * to for accessibility fixes.
 */

const CHART_HEIGHT = 64;
const BAR_WIDTH = 14;
const GAP = 8;

/** Net points per gameweek — the number that actually adds up to the season total. */
export function GameweekPointsChart({ gameweeks }: { gameweeks: readonly GameweekResult[] }) {
  if (gameweeks.length === 0) return null;

  const max = Math.max(1, ...gameweeks.map((g) => g.net));
  const width = gameweeks.length * (BAR_WIDTH + GAP);
  const describe = (g: GameweekResult) =>
    `gameweek ${g.gameweek}, ${g.net} point${g.net === 1 ? '' : 's'}` +
    (g.transferCost > 0 ? ` after a ${g.transferCost} point transfer cost` : '') +
    (g.chip ? `, ${g.chip} played` : '');

  return (
    <figure className="px-3 py-3">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`Points by gameweek: ${gameweeks.map(describe).join('; ')}`}
          viewBox={`0 0 ${width} ${CHART_HEIGHT + 14}`}
          width={Math.max(width, 200)}
          height={CHART_HEIGHT + 14}
        >
          {gameweeks.map((g, i) => {
            const h = Math.max(2, (Math.max(0, g.net) / max) * CHART_HEIGHT);
            const x = i * (BAR_WIDTH + GAP);
            const y = CHART_HEIGHT - h;
            return (
              <g key={g.gameweek}>
                <rect
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={h}
                  rx={2}
                  className={g.chip ? 'fill-comp-pl' : 'fill-text'}
                  opacity={g.chip ? 1 : 0.82}
                >
                  <title>{describe(g)}</title>
                </rect>
                <text
                  x={x + BAR_WIDTH / 2}
                  y={CHART_HEIGHT + 11}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize="7"
                >
                  {g.gameweek}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="sr-only">
        Points by gameweek: {gameweeks.map(describe).join(', ')}.
      </figcaption>
    </figure>
  );
}

/**
 * One player's raw points, gameweek by gameweek — the form line
 * app/player/[slug]/page.tsx used to say plainly did not exist. It exists
 * now: the fantasy ingest stores exactly this, per gameweek, for every
 * Premier League player, whether or not they are in anyone's fantasy squad.
 * A gameweek with no published score yet (`points === null`) is skipped
 * rather than drawn as zero — the same "missing is not nothing" rule
 * `lib/fantasy/standings.ts` applies to a manager's own history.
 */
export function PlayerFormChart({
  gameweeks,
}: {
  gameweeks: readonly { gameweek: number; points: number | null }[];
}) {
  const played = gameweeks.filter((g): g is { gameweek: number; points: number } => g.points !== null);
  if (played.length === 0) return null;

  const max = Math.max(1, ...played.map((g) => g.points));
  const width = played.length * (BAR_WIDTH + GAP);
  const describe = (g: { gameweek: number; points: number }) =>
    `gameweek ${g.gameweek}, ${g.points} point${g.points === 1 ? '' : 's'}`;

  return (
    <figure className="px-3 py-3">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`Points by gameweek: ${played.map(describe).join('; ')}`}
          viewBox={`0 0 ${width} ${CHART_HEIGHT + 14}`}
          width={Math.max(width, 160)}
          height={CHART_HEIGHT + 14}
        >
          {played.map((g, i) => {
            const h = Math.max(2, (Math.max(0, g.points) / max) * CHART_HEIGHT);
            const x = i * (BAR_WIDTH + GAP);
            const y = CHART_HEIGHT - h;
            return (
              <g key={g.gameweek}>
                <rect x={x} y={y} width={BAR_WIDTH} height={h} rx={2} className="fill-text" opacity={0.82}>
                  <title>{describe(g)}</title>
                </rect>
                <text x={x + BAR_WIDTH / 2} y={CHART_HEIGHT + 11} textAnchor="middle" className="fill-muted" fontSize="7">
                  {g.gameweek}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="sr-only">Points by gameweek: {played.map(describe).join(', ')}.</figcaption>
    </figure>
  );
}

/** Budget spent, as a filled bar against the £100.0m cap — the number a manager checks most. */
export function BudgetBar({ spent, total }: { spent: number; total: number }) {
  const pct = Math.min(100, Math.max(0, (spent / total) * 100));
  const over = spent > total;
  return (
    <div className="w-full min-w-[10rem] flex-1 sm:w-40 sm:flex-none">
      <div
        role="img"
        aria-label={`${formatPrice(spent)} of ${formatPrice(total)} spent`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={`h-full rounded-full ${over ? 'bg-live' : 'bg-text'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
