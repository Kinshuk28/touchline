import { Mark } from '@/components/Mark';

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
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface">
      {/* The floodlight sweep. Purely decorative, sits under the content,
          and never touches text contrast — it is a 6%-white band moving
          across an opaque surface. */}
      <span className="tl-sweep pointer-events-none absolute inset-0 z-0" aria-hidden="true" />

      <div className="relative z-10 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="max-w-prose">
          <p className="flex items-center gap-2 text-11 font-bold uppercase tracking-[0.14em] text-muted">
            <Mark size={14} />
            Fantasy
          </p>
          <h2 className="mt-2 font-display text-24 font-extrabold leading-tight tracking-[-0.02em] sm:text-32">
            Build an XI from all five leagues.
          </h2>
          <p className="mt-2 text-15 text-muted">
            Pick a squad across the Premier League, La Liga, Serie A, the Bundesliga and Ligue 1, score
            it on real results as they land, and run a league against your friends.
          </p>
          {/* Honest about state: this is not a link, because there is
              nothing to link to yet. */}
          <p className="mt-3 inline-block rounded-full border border-border px-2.5 py-1 font-mono text-11 uppercase tracking-wider text-muted">
            In development
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
              className="aspect-video w-full rounded-lg border border-border bg-surface-2"
              role="img"
              aria-label="Illustration: a 4-3-3 formation, with a passing move running from left-back to a shot on goal"
            >
              {/* Pitch markings — the same chalk-on-turf vocabulary as the
                  page background, at panel scale. */}
              <g stroke="currentColor" fill="none" className="text-border">
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
                  className="tl-pop fill-text"
                  style={{ animationDelay: `${300 + i * 90}ms` }}
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
