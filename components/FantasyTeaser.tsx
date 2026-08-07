import { Mark } from '@/components/Mark';
import { Button } from '@/components/ui/Button';

/**
 * The move the ball plays, as one path: left-back to a midfielder, out to
 * the right winger, cut back to the striker, then struck at goal. Defined
 * once and used twice — as the `d` of the drawn passing line, and as the
 * `offset-path` the ball travels along — so the line and the ball can never
 * drift apart.
 */
const PASS_PATH = 'M78 72 L160 52 L244 44 L244 90 L306 90';

/**
 * The Fantasy teaser — the one openly promotional block on the site, and
 * therefore the only place illustrative or generated motion can honestly
 * live. Everything else on this page is stored data, and a clip sitting
 * next to real fixtures would read as match footage this project does not
 * have.
 *
 * The art is a formation diagram: a pitch, eleven position dots in a 4-3-3,
 * and a passing move played through them. It claims nothing about any real
 * match, player or result — it is the shape of the feature, not a record of
 * anything.
 *
 * MOTION — four animations, all CSS, no library and no dependency:
 *
 * - the eleven dots arrive one after another (`tl-pop`, 90ms apart): the
 *   squad being picked;
 * - the passing line draws itself along `PASS_PATH` (`tl-pass`);
 * - the ball runs the identical path (`tl-ball`, via `offset-path`), reaches
 *   goal, holds while the completed move is legible, then everything fades
 *   and the nine-second loop starts again;
 * - a floodlight crosses the panel (`tl-sweep`).
 *
 * `prefers-reduced-motion` (app/globals.css) resolves the dots to their
 * placed state, leaves the passing line drawn — a static tactics diagram —
 * and removes the ball and the sweep, whose only content was the movement.
 *
 * `videoSrc` is the drop-in point for a generated clip: pass it with a
 * `poster` frame and the panel plays that instead of drawing this.
 * Deliberately unset — a `<video>` with no source is a broken black box,
 * and this animation costs nothing to serve.
 */
export function FantasyTeaser({
  videoSrc, poster,
}: {
  /** Path to a looping, muted background clip in `public/`. Omit to draw the animated formation instead. */
  videoSrc?: string;
  /** First-frame image for `videoSrc`. Required whenever `videoSrc` is set — it is what a reduced-motion or slow-connection reader sees. */
  poster?: string;
}) {
  // Approximate 4-3-3, in the SVG's own 320x180 coordinate space: keeper at
  // the back, four across, three in midfield, three up top.
  const formation: Array<[number, number]> = [
    [24, 90],
    [78, 34], [78, 72], [78, 108], [78, 146],
    [160, 52], [160, 90], [160, 128],
    [244, 44], [244, 90], [244, 136],
  ];

  return (
    <section className="relative overflow-hidden border-2 border-comp-pl bg-black/80 shadow-[0_0_30px_rgba(255,0,255,0.15)]">
      {/* The floodlight sweep, now a cyan scanning beam. Purely decorative,
          sits under the content, and never touches text contrast. */}
      <span className="tl-sweep pointer-events-none absolute inset-0 z-0" aria-hidden="true" />

      <div className="relative z-10 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="max-w-prose">
          <p className="flex items-center gap-2 text-11 font-bold uppercase tracking-[0.2em] text-comp-pd">
            <Mark size={14} />
            Fantasy
          </p>
          <h2 className="mt-2 bg-gradient-to-r from-comp-sa via-comp-pl to-comp-pd bg-clip-text font-display text-24 font-black uppercase leading-tight tracking-[-0.01em] text-transparent drop-shadow-[0_0_30px_rgba(255,0,255,0.4)] sm:text-32">
            Build a Premier League squad.
          </h2>
          {/* Narrowed from "all five leagues" when the game was actually
              built. Per-match player scoring exists on a free tier for the
              Premier League and nowhere else, and a teaser promising four
              more competitions would be selling something the data cannot
              deliver — see docs/superpowers/specs/2026-08-07-fantasy-phase-c.md. */}
          <p className="mt-2 text-15 text-muted">
            Pick fifteen players inside a {'\u00A3'}100m budget, captain one of them, and score
            your side on real Premier League gameweeks as the results land.
          </p>
          <p className="mt-3">
            <Button href="/fantasy" size="sm">Pick your squad →</Button>
          </p>
        </div>

        <div className="shrink-0 sm:w-[24rem]">
          {videoSrc ? (
            /* Muted + autoplay + playsInline is the only combination browsers
               will start on their own; `loop` because a teaser that stops
               after one pass is worse than no motion at all. The poster
               carries the panel until the clip is decoded, and is all a
               reduced-motion reader ever sees (`preload="none"` there). */
            <video
              className="aspect-video w-full rounded-lg border border-border object-cover motion-reduce:hidden"
              src={videoSrc}
              poster={poster}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          ) : (
            <svg
              viewBox="0 0 320 180"
              className="aspect-video w-full border-2 border-comp-pd/50 bg-black"
              role="img"
              aria-label="Illustration: a 4-3-3 formation, with a passing move running from left-back to a shot on goal"
            >
              {/* Pitch markings — neon wireframe on black, the same
                  vocabulary as the grid floor behind the whole page. */}
              <g stroke="currentColor" fill="none" className="text-comp-pl/50">
                <rect x="8" y="8" width="304" height="164" rx="2" strokeWidth="1.5" />
                <line x1="160" y1="8" x2="160" y2="172" strokeWidth="1.5" />
                <circle cx="160" cy="90" r="30" strokeWidth="1.5" />
                <rect x="8" y="45" width="34" height="90" strokeWidth="1.5" />
                <rect x="278" y="45" width="34" height="90" strokeWidth="1.5" />
              </g>
              {/* The XI. `tl-pop` with a per-dot delay: the squad fills in
                  from the back. */}
              {formation.map(([cx, cy], i) => (
                <circle
                  key={`${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r="6"
                  className="tl-pop fill-comp-pd"
                  style={{ animationDelay: `${300 + i * 90}ms`, filter: 'drop-shadow(0 0 4px var(--comp-pd))' }}
                />
              ))}

              {/* The move, on a nine-second loop: the passing line draws
                  itself, the ball runs along the identical path, the strike
                  lands, everything fades and it goes again. `pathLength="1"`
                  normalises the dash arithmetic, so the draw-on works
                  without measuring the path in JavaScript. */}
              <path
                className="tl-pass"
                d={PASS_PATH}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="1"
                pathLength="1"
                style={{ animationDelay: '1.4s' }}
              />
              <circle
                className="tl-ball"
                r="4.5"
                style={{ offsetPath: `path("${PASS_PATH}")`, animationDelay: '1.4s' }}
              />
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}
