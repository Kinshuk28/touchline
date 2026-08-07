import type { FantasyPosition } from '@/lib/fantasy/squadRules';
import type { Chip } from '@/lib/fantasy/chips';

/**
 * The fantasy game's own small icon set — inline SVG, `currentColor`, no
 * library and no new dependency, same convention as components/Mark.tsx.
 *
 * Every icon here is decorative: it always sits beside the text that already
 * carries the meaning (a position code, a chip's name), never in place of
 * it. `aria-hidden` follows from that — nothing here is read out on its own,
 * and nothing here is the only way to know what it is.
 */

const STROKE = 1.6;

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** A save: a ball dropping into a keeper's hands. */
function GkGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M4 16c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <circle cx="12" cy="5.5" r="2" fill="currentColor" />
    </Svg>
  );
}

/** A shield — the defensive line. */
function DefGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path
        d="M12 3.2l6.5 2.6v5.4c0 4.6-3.1 7.5-6.5 8.6-3.4-1.1-6.5-4-6.5-8.6V5.8L12 3.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Two arrows circulating the ball — a midfield that recycles possession. */
function MidGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M5.5 9.5A6.3 6.3 0 0 1 16.5 5.3M18 5v3.6h-3.6" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 14.5A6.3 6.3 0 0 1 7.5 18.7M6 19v-3.6h3.6" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A shot on goal: ball, and the strike toward the top corner. */
function FwdGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <circle cx="6" cy="17.5" r="2.1" fill="currentColor" />
      <path d="M8.6 15L18 5.6M18 5.6h-5M18 5.6v5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const POSITION_GLYPHS: Record<FantasyPosition, (props: { size: number }) => React.ReactElement> = {
  GK: GkGlyph,
  DEF: DefGlyph,
  MID: MidGlyph,
  FWD: FwdGlyph,
};

export function PositionIcon({ position, size = 14 }: { position: FantasyPosition; size?: number }) {
  const Glyph = POSITION_GLYPHS[position];
  return <Glyph size={size} />;
}

/** A joker card — one change of plan, played once. */
function WildcardGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M12 8l1.15 2.35 2.6.38-1.88 1.83.44 2.59L12 13.9l-2.31 1.25.44-2.59-1.88-1.83 2.6-.38z" fill="currentColor" />
    </Svg>
  );
}

/** A bolt — a one-week side, borrowed and gone. */
function FreeHitGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M13 2.5L4.5 14h5.5l-1 7.5 9.5-12.5H13z" fill="currentColor" />
    </Svg>
  );
}

/** A crown — the captain's armband, tripled. */
function TripleCaptainGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M4.5 8.5l2.8 2.6L12 5l4.7 6.1 2.8-2.6L20 17H4l.5-8.5z" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" />
    </Svg>
  );
}

/** An arrow lifting the whole bench, not just the eleven. */
function BenchBoostGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d="M12 3.5l4.2 4.3h-2.7v9.2h-3V7.8H7.8L12 3.5z" fill="currentColor" />
      <path d="M6 20h12" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

const CHIP_GLYPHS: Record<Chip, (props: { size: number }) => React.ReactElement> = {
  wildcard: WildcardGlyph,
  'free-hit': FreeHitGlyph,
  'triple-captain': TripleCaptainGlyph,
  'bench-boost': BenchBoostGlyph,
};

export function ChipIcon({ chip, size = 14 }: { chip: Chip; size?: number }) {
  const Glyph = CHIP_GLYPHS[chip];
  return <Glyph size={size} />;
}

export function TransferInIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 4v12m0 0l-3.5-3.5M12 16l3.5-3.5M5 20h14" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TransferOutIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 20V8m0 0l-3.5 3.5M12 8l3.5 3.5M5 4h14" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The league leader's marker — never the only signal of rank, always beside the number. */
export function TrophyIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M7 4h10v3.2a5 5 0 0 1-10 0V4z" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <path d="M7 5H4.3v1.8A3 3 0 0 0 7 9.8M17 5h2.7v1.8A3 3 0 0 1 17 9.8" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
      <path d="M12 12.2V16m-2.8 4h5.6M12 16v4" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * The Google sign-in mark — a plain circular monogram in the site's own
 * monochrome-inline-SVG style, not a reproduction of Google's four-colour
 * logo. This site draws every icon itself; a borrowed brand mark would be
 * the one exception to that, so it isn't one.
 */
export function GoogleGlyph({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <path
        d="M12 8v4h4.4c-.3 1.9-1.9 3.5-4.4 3.5A4.5 4.5 0 1 1 12 7.5c1.1 0 2.1.4 2.9 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
