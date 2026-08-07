import type { FantasyPosition } from '@/lib/fantasy/squadRules';
import type { Chip } from '@/lib/fantasy/chips';
import { CHIP_LABELS } from '@/lib/fantasy/chips';
import { POSITION_COLORS, CHIP_COLORS } from '@/lib/fantasy/fantasyColors';
import { PositionIcon, ChipIcon } from '@/components/fantasy/icons';

/**
 * A position, as a small coloured tag: icon, code and colour together — the
 * same information the plain-text `GK`/`DEF`/`MID`/`FWD` columns already
 * gave, with the position's own colour and glyph added rather than
 * substituted. The code is still the thing a screen reader or a
 * colour-blind reader gets; the colour is decoration on top of it.
 */
export function PositionBadge({ position, className = '' }: { position: FantasyPosition; className?: string }) {
  const color = POSITION_COLORS[position];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1 py-0.5 font-mono text-11 uppercase tracking-wider ${color.textClass} ${color.bgClass} ${color.borderClass} ${className}`}
    >
      <PositionIcon position={position} size={11} />
      {position}
    </span>
  );
}

/** A chip's name, coloured and iconed the same way as `PositionBadge`. */
export function ChipBadge({ chip, className = '' }: { chip: Chip; className?: string }) {
  const color = CHIP_COLORS[chip];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-11 font-semibold uppercase tracking-wider ${color.textClass} ${color.bgClass} ${color.borderClass} ${className}`}
    >
      <ChipIcon chip={chip} size={11} />
      {CHIP_LABELS[chip]}
    </span>
  );
}
