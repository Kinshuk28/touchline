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
  label, meta, action, children,
}: {
  label: string;
  /** Small mono qualifier next to the label — a date range, a season, a count. Muted, never the panel's main information. */
  meta?: ReactNode;
  /** Right-aligned link out to the full page this panel is a summary of. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
        <h2 className="font-display text-11 font-bold uppercase tracking-[0.14em]">{label}</h2>
        {meta && <span className="min-w-0 truncate font-mono text-11 uppercase tracking-wider text-muted">{meta}</span>}
        {action && <span className="ml-auto shrink-0 text-11 text-muted">{action}</span>}
      </header>
      {children}
    </section>
  );
}
