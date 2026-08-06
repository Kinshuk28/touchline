import { Mark } from '@/components/Mark';

/**
 * The Fantasy teaser — the one openly promotional block on the site, and
 * therefore the only place a piece of generated or illustrative motion can
 * honestly live. Everything else on this page is real stored data, and a
 * generated clip sitting next to real fixtures would read as match footage
 * we do not have.
 *
 * The art is a formation diagram, drawn in SVG: a pitch and eleven position
 * dots in a 4-3-3, which is what the feature will actually ask you to fill
 * in. It claims nothing about any real match, player or result.
 *
 * MOTION. Three CSS animations, no library, no dependency:
 *
 * - the eleven dots arrive one after another (`tl-pop`, 90ms apart), which
 *   is the squad being picked;
 * - a floodlight sweeps across the panel every 9 seconds (`tl-sweep`);
 * - the pitch lines hold still, because a moving pitch is a gimmick.
 *
 * All three are suppressed by `prefers-reduced-motion` (see app/globals.css)
 * — the dots resolve to their placed state rather than vanishing.
 *
 * `videoSrc` is the drop-in point for a generated clip: pass it and a
 * `poster` frame, and the panel plays that behind the copy instead of
 * drawing the diagram. Deliberately optional and deliberately unset today —
 * there is no clip in the repo yet, and a `<video>` element with no source
 * is a broken black box.
 */
export function FantasyTeaser({
  videoSrc, poster,
}: {
  /** Path to a looping, muted background clip in `public/`. Omit to draw the formation diagram instead. */
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

        <div className="shrink-0 sm:w-[20rem]">
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
              aria-label="Illustration: a 4-3-3 formation laid out on a pitch"
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
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}
