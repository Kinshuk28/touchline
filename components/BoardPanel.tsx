import type { ReactNode } from 'react';

/**
 * One panel of the dashboard — the shared chrome so every panel on every
 * page reads as one system: the same glass surface, the same neon-green top
 * edge, the same chamfered terminal-style label bar.
 *
 * The `border-t-2 border-t-comp-pl` top edge plus `bg-surface/80` is the
 * system's own "Standard Card" pattern, applied once here rather than at
 * each of the panel's ~15-20 call sites across the site — every page that
 * already used `BoardPanel` picked up the reskin with no change of its own.
 * `.cyber-cut` (app/globals.css) clips the corners instead of rounding them.
 *
 * NOT `backdrop-blur` — the system's own spec calls for it, but this
 * component alone accounts for most of a page's panels, and `backdrop-filter`
 * is one of the few CSS properties that forces a browser to keep re-blurring
 * everything behind an element on every scroll and repaint, not just paint it
 * once. Fifteen-plus of those stacked over the fixed grid/scanline
 * background (app/globals.css) measurably slowed down interaction on the
 * live site — clicks and hovers visibly lagged behind the compositor
 * catching up. `bg-surface/80` alone still reads as a translucent glass
 * panel; it just doesn't cost a re-blur of the whole page under it on every
 * frame to get there.
 *
 * Deliberately thin. It owns the frame and the header row and nothing else;
 * every panel's contents (the spine, the mini table, the rails) stay
 * independently usable components with no knowledge of this.
 */
export function BoardPanel({
  label, meta, action, children, order = 0,
}: {
  label: string;
  /** Small mono qualifier next to the label — a date range, a season, a count. Muted, never the panel's main information. */
  meta?: ReactNode;
  /** Right-aligned link out to the full page this panel is a summary of. */
  action?: ReactNode;
  children: ReactNode;
  /**
   * Position in the board's entrance, left to right. Each panel rises into
   * place 70ms after the one before it, which reads as the board being
   * dealt out rather than four things appearing at once. Deliberately
   * short: the last panel is settled 250ms in, so nothing is ever waiting
   * on the animation to be readable, and it plays once per load rather
   * than looping. Fully suppressed under `prefers-reduced-motion` — see
   * `.tl-rise` in app/globals.css.
   */
  order?: number;
}) {
  return (
    <section
      className="cyber-cut tl-rise overflow-hidden border border-comp-pl/20 border-t-2 border-t-comp-pl bg-surface/80"
      style={{ animationDelay: `${order * 70}ms` }}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5">
        <h2 className="font-display text-11 font-bold uppercase tracking-[0.14em] text-comp-pl drop-shadow-[0_0_5px_rgba(0,255,136,0.6)]">
          {label}
        </h2>
        {meta && <span className="min-w-0 truncate font-mono text-11 uppercase tracking-wider text-muted">{meta}</span>}
        {action && <span className="ml-auto shrink-0 font-mono text-11 text-muted">{action}</span>}
      </header>
      {children}
    </section>
  );
}
