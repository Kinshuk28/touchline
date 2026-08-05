/**
 * The identity mark — defect 4 of the dashboard-rebuild spec ("the wordmark
 * is plain text. Add one small restrained mark from football's own
 * geometry — a corner arc, centre circle, goal frame — in CSS or inline
 * SVG. No emoji, no icon library.")
 *
 * It is a corner arc: the touchline and goal line meeting at a right angle,
 * with the quarter-circle the corner flag stands in. Chosen over the centre
 * circle (a plain circle reads as a bullet or a loading spinner at 16px)
 * and over the goal frame (a three-sided box at this size is just a box).
 * The corner arc is the one piece of pitch geometry that stays legible when
 * it is small, and the site is named after the line it draws.
 *
 * Inline SVG, `currentColor`, no library and no new dependency — it
 * inherits the wordmark's colour in both themes for free, including the
 * focus ring's. `strokeWidth` is set in the 24-unit viewBox, so at the
 * 18px render size the strokes land near 1.1 device pixels: the same
 * hairline weight as `--border`, which is what keeps it a mark rather than
 * a logo.
 */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="shrink-0"
    >
      {/* Goal line (horizontal) and touchline (vertical), meeting at the corner. */}
      <path
        d="M2 22h20M2 22V2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
      {/* The corner arc itself, struck from the corner point. */}
      <path
        d="M11 22A9 9 0 0 0 2 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
