import type { FantasyPosition } from '@/lib/fantasy/squadRules';
import type { Chip } from '@/lib/fantasy/chips';

/**
 * Colour for a position or a chip — Tailwind utility classes backed by the
 * `--comp-*` tokens in app/globals.css, the same tokens the competition
 * badges use (lib/site/competition.ts). Reused rather than invented: those
 * five hues are already AA-checked against both surfaces in both themes, and
 * a sixth accent family would need the same work done twice.
 *
 * Every class here is a literal string, not built from a template at the
 * call site — Tailwind's scanner only generates CSS for class names it can
 * find as substrings in the source, so `` `text-${x}` `` would silently
 * produce nothing. See the comment on CompetitionMeta for the same rule.
 *
 * Colour never carries this meaning alone: every badge that uses one of
 * these also prints the position code or chip name in words.
 */
export interface FantasyColor {
  textClass: string;
  bgClass: string;
  borderClass: string;
}

export const POSITION_COLORS: Readonly<Record<FantasyPosition, FantasyColor>> = {
  GK: { textClass: 'text-comp-sa', bgClass: 'bg-comp-sa/15', borderClass: 'border-comp-sa/40' },
  DEF: { textClass: 'text-comp-fl1', bgClass: 'bg-comp-fl1/15', borderClass: 'border-comp-fl1/40' },
  MID: { textClass: 'text-comp-bl1', bgClass: 'bg-comp-bl1/15', borderClass: 'border-comp-bl1/40' },
  FWD: { textClass: 'text-comp-pd', bgClass: 'bg-comp-pd/15', borderClass: 'border-comp-pd/40' },
};

export const CHIP_COLORS: Readonly<Record<Chip, FantasyColor>> = {
  wildcard: { textClass: 'text-comp-pl', bgClass: 'bg-comp-pl/15', borderClass: 'border-comp-pl/40' },
  'free-hit': { textClass: 'text-comp-pd', bgClass: 'bg-comp-pd/15', borderClass: 'border-comp-pd/40' },
  'triple-captain': { textClass: 'text-comp-bl1', bgClass: 'bg-comp-bl1/15', borderClass: 'border-comp-bl1/40' },
  'bench-boost': { textClass: 'text-comp-fl1', bgClass: 'bg-comp-fl1/15', borderClass: 'border-comp-fl1/40' },
};
