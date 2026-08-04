/**
 * Maps a league's `fd_code` to its competition colour and display name —
 * the single source of truth so no component ever reaches for a raw hex
 * string. Colours are Tailwind utility classes backed by the `--comp-*`
 * tokens in app/globals.css's `@theme inline` block (dark values there,
 * AA-checked light-theme equivalents in the light overrides), not inline
 * styles, so the correct value is always picked up per-theme for free.
 *
 * An `fd_code` outside the top five falls back to `--muted` — never an
 * invented colour — per the redesign spec.
 */
export interface CompetitionMeta {
  /** The `fd_code` this meta was resolved for (echoed back, including unmapped codes). */
  code: string;
  /** Display name — always present, so colour is never the only carrier of meaning. */
  name: string;
  /** Tailwind `bg-*` utility for the competition colour (or `bg-muted` when unmapped). */
  bgClass: string;
  /** Tailwind `text-*` utility for the competition colour (or `text-muted` when unmapped). */
  textClass: string;
  /** Tailwind `border-*` utility for the competition colour (or `border-muted` when unmapped). */
  borderClass: string;
}

type Known = Omit<CompetitionMeta, 'code'>;

const KNOWN: Record<string, Known> = {
  PL:  { name: 'Premier League', bgClass: 'bg-comp-pl',  textClass: 'text-comp-pl',  borderClass: 'border-comp-pl' },
  PD:  { name: 'La Liga',        bgClass: 'bg-comp-pd',  textClass: 'text-comp-pd',  borderClass: 'border-comp-pd' },
  SA:  { name: 'Serie A',        bgClass: 'bg-comp-sa',  textClass: 'text-comp-sa',  borderClass: 'border-comp-sa' },
  BL1: { name: 'Bundesliga',     bgClass: 'bg-comp-bl1', textClass: 'text-comp-bl1', borderClass: 'border-comp-bl1' },
  FL1: { name: 'Ligue 1',        bgClass: 'bg-comp-fl1', textClass: 'text-comp-fl1', borderClass: 'border-comp-fl1' },
};

const FALLBACK: Known = {
  name: 'Other competition',
  bgClass: 'bg-muted',
  textClass: 'text-muted',
  borderClass: 'border-muted',
};

/**
 * Resolves a league's `fd_code` to its colour + display name. Never throws
 * and never invents a colour: any code not in the top five (including an
 * empty string) resolves to the `--muted` fallback.
 */
export function getCompetitionMeta(fdCode: string): CompetitionMeta {
  const known = KNOWN[fdCode];
  return known ? { code: fdCode, ...known } : { code: fdCode, ...FALLBACK };
}

/** The five codes this module actually has a colour for. */
export const KNOWN_COMPETITION_CODES = Object.keys(KNOWN);
