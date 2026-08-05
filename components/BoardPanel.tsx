import type { ReactNode } from 'react';

/**
 * One panel of the landing dashboard — the shared chrome so the board's
 * four columns read as one board rather than four unrelated cards: the same
 * hairline frame, the same 11px uppercase label bar, the same place for a
 * "more" link.
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
      className="tl-rise overflow-hidden rounded-xl border border-border bg-surface"
      style={{ animationDelay: `${order * 70}ms` }}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
        <h2 className="font-display text-11 font-bold uppercase tracking-[0.14em]">{label}</h2>
        {meta && <span className="min-w-0 truncate font-mono text-11 uppercase tracking-wider text-muted">{meta}</span>}
        {action && <span className="ml-auto shrink-0 text-11 text-muted">{action}</span>}
      </header>
      {children}
    </section>
  );
}
