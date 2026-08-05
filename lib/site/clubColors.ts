/**
 * `teams.club_colors` is free text — "Claret / Sky Blue", "Red / White",
 * "Royal Blue / White / Black" — sourced verbatim from football-data.org.
 * Direction Two's core move is using these as the site's only chroma system
 * (see docs/superpowers/specs/2026-08-04-touchline-direction-two.md), which
 * means every value has to resolve to real colour or explicitly fail — never
 * a fuzzy guess.
 *
 * A full pass over the live `teams` table (110 clubs, 96 with a non-null
 * `club_colors`) found exactly 17 distinct named-colour tokens once each
 * value is split on "/" and trimmed — see this pass's report
 * (.superpowers/sdd/direction-two-foundation-report.md) for the frequency
 * table. That closed vocabulary is what makes a complete lookup possible
 * with no fuzzy matching: a token outside this list is unparseable, full
 * stop, never coerced to "the closest colour".
 *
 * Hexes below are picked to read as bars/fills against the turf ground
 * (`--turf` #0C1512 dark, `--turf` #F7F5F0 paper light) — see
 * `passesAATextOn` and the report for which of the 17 also clear AA as
 * *text*, which most do not by design (a literal "black" or "claret" kit
 * colour is not going to be readable body text on a near-black or
 * near-white ground, and it was never meant to be — the contrast guard
 * below is what keeps that colour confined to bars and fills).
 */
export const CLUB_COLOR_HEX: Readonly<Record<string, string>> = {
  white: '#F4F6F2',
  red: '#E1362C',
  blue: '#3B7DE8',
  black: '#20302A',
  'sky blue': '#4FC3F7',
  green: '#2FA84F',
  'navy blue': '#28407A',
  yellow: '#F2C230',
  orange: '#F2843C',
  purple: '#8C6FE0',
  claret: '#8A2846',
  'royal blue': '#3457D5',
  crimson: '#D42A48',
  maroon: '#7A2836',
  brown: '#9A6A3C',
  gold: '#D4AF37',
  violet: '#9D6CF0',
};

/** One or two parsed club colours — never zero, never three (see `parseClubColors`). */
export type ClubColors = readonly [string] | readonly [string, string];

/**
 * Parses a `teams.club_colors` value into one or two hex colours, or
 * `null`. Rules, in order:
 *
 * - `null`/empty/whitespace-only input → `null`.
 * - Split on "/", trim and lowercase each part. A value like
 *   "Red / White / Black" (17 of the 96 non-null rows in the live table
 *   carry a third token) keeps only the first two — a shirt's primary and
 *   secondary colour, which is what a two-stop bar needs; the third token
 *   is trim the bar has no use for regardless.
 * - Every token consulted (at most two) must resolve via `CLUB_COLOR_HEX`.
 *   One unrecognised token fails the *whole* value — this never returns a
 *   partial result or invents a colour for the token it couldn't place.
 * - Two tokens that resolve to the same hex (doesn't happen in the live
 *   data, but the parser doesn't assume it can't) collapse to a single-colour
 *   result rather than a degenerate two-stop gradient with identical stops.
 */
export function parseClubColors(raw: string | null | undefined): ClubColors | null {
  if (!raw) return null;
  const tokens = raw
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) return null;

  const hexes: string[] = [];
  for (const token of tokens.slice(0, 2)) {
    const hex = CLUB_COLOR_HEX[token];
    if (!hex) return null;
    hexes.push(hex);
  }

  const first = hexes[0];
  if (first === undefined) return null;
  const second = hexes[1];
  if (second === undefined || second === first) return [first] as const;
  return [first, second] as const;
}

/** The club's primary (first-listed) colour, or `null` if unparseable/missing. */
export function primaryClubColor(raw: string | null | undefined): string | null {
  const parsed = parseClubColors(raw);
  return parsed ? parsed[0] : null;
}

/**
 * A CSS `background` value for a fixture row's left-edge club-colour bar: a
 * top-to-bottom two-stop gradient from the home club's primary colour to the
 * away club's. Direction Two spec: "a two-stop gradient bar from the two
 * clubs' colours ... running the row's left edge. Real data, different
 * every match."
 *
 * Neutral-fallback rule (never invents a club's colour):
 * - Both parse: a real two-stop gradient between the two.
 * - One parses: that colour fading to `var(--line)` — still a two-stop
 *   gradient, just honest about only having one real data point.
 * - Neither parses: `null`, so the caller renders no bar at all rather than
 *   a gradient between two invented colours. The competition-colour bar
 *   (kept as a separate element everywhere this is used) still carries the
 *   row, so it never looks broken or empty.
 */
export function clubBarGradient(
  homeClubColors: string | null | undefined,
  awayClubColors: string | null | undefined,
): string | null {
  const home = primaryClubColor(homeClubColors);
  const away = primaryClubColor(awayClubColors);
  if (!home && !away) return null;
  return `linear-gradient(to bottom, ${home ?? 'var(--line)'}, ${away ?? 'var(--line)'})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbChannelToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two colours, 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The contrast guard the Direction Two spec requires: "if a parsed colour
 * fails AA against the ground, use it only as a bar or fill, never as
 * text." `4.5:1` is the AA floor for normal text (WCAG 2.1 SC 1.4.3); a
 * caller must check this before ever setting a parsed club colour as a
 * `color` (as opposed to a `background`/`border`/fill).
 */
export function passesAATextOn(hex: string, groundHex: string, threshold = 4.5): boolean {
  return contrastRatio(hex, groundHex) >= threshold;
}
