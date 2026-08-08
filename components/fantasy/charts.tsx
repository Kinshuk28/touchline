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

const TREND_HEIGHT = 120;
const TREND_STEP = 34;
const TREND_PAD = 10;

/**
 * Fixed, literal cycles — Tailwind only generates CSS for class names it can
 * find as substrings in source, so neither of these can be built from a
 * template at the call site (`text-comp-pl` → `bg-comp-pl` by string
 * replacement would silently produce no rule). Five hues, the same ones
 * every competition badge on the site already uses; the two arrays are
 * index-aligned on purpose.
 */
const LINE_COLORS = ['text-comp-pl', 'text-comp-pd', 'text-comp-sa', 'text-comp-bl1', 'text-comp-fl1'] as const;
const LINE_SWATCH_COLORS = ['bg-comp-pl', 'bg-comp-pd', 'bg-comp-sa', 'bg-comp-bl1', 'bg-comp-fl1'] as const;

export interface TrendSeries {
  userId: string;
  label: string;
  /** Cumulative points, one entry per member of `gameweeks`, same order. */
  points: readonly number[];
  /** The viewer's own line — drawn heavier, so it's findable in a crowded chart without depending on colour alone. */
  isYou?: boolean;
}

/**
 * A season's shape, not just its current total: cumulative points across
 * every scored gameweek, one line per manager. The table already says who
 * is ahead; this says how they got there — a manager who has been tied for
 * three weeks reads completely differently from one who has been ahead the
 * whole way, and the total alone cannot tell those two seasons apart.
 *
 * Capped upstream (app/fantasy/leagues/[id]/page.tsx) to the top few
 * managers — a line chart with twenty overlapping series is not more
 * informative than one with six, and the panel says outright when it is
 * showing fewer than the whole league.
 */
export function LeagueTrendChart({ gameweeks, series }: { gameweeks: readonly number[]; series: readonly TrendSeries[] }) {
  if (gameweeks.length === 0 || series.length === 0) return null;

  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const width = TREND_PAD * 2 + (gameweeks.length - 1) * TREND_STEP;
  const xAt = (i: number) => TREND_PAD + i * TREND_STEP;
  const yAt = (v: number) => TREND_HEIGHT - (v / max) * (TREND_HEIGHT - 8) - 4;

  const describe = (s: TrendSeries) =>
    `${s.label}: ${gameweeks.map((gw, i) => `gameweek ${gw} ${s.points[i] ?? 0} points`).join(', ')}`;

  return (
    <figure className="px-3 py-3">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`Cumulative points by gameweek. ${series.map(describe).join('. ')}`}
          viewBox={`0 0 ${Math.max(width, 120)} ${TREND_HEIGHT + 16}`}
          width={Math.max(width, 220)}
          height={TREND_HEIGHT + 16}
        >
          {gameweeks.map((gw, i) => (
            <text key={gw} x={xAt(i)} y={TREND_HEIGHT + 13} textAnchor="middle" className="fill-muted" fontSize="7">
              {gw}
            </text>
          ))}
          {series.map((s, si) => {
            const color = LINE_COLORS[si % LINE_COLORS.length];
            const d = s.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(v)}`).join(' ');
            return (
              <path
                key={s.userId}
                d={d}
                fill="none"
                className={color}
                stroke="currentColor"
                strokeWidth={s.isYou ? 2.75 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.isYou ? 1 : 0.65}
              >
                <title>{describe(s)}</title>
              </path>
            );
          })}
        </svg>
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s, si) => (
          <li key={s.userId} className="flex items-center gap-1.5 text-11 text-muted">
            <span className={`size-1.5 rounded-full ${LINE_SWATCH_COLORS[si % LINE_SWATCH_COLORS.length]}`} aria-hidden="true" />
            <span className={s.isYou ? 'font-semibold text-text' : ''}>{s.label}</span>
            <span className="font-mono tabular-nums">{s.points.at(-1) ?? 0}</span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{series.map(describe).join('. ')}.</figcaption>
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
