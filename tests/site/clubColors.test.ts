import { describe, it, expect } from 'vitest';
import {
  CLUB_COLOR_HEX,
  parseClubColors,
  primaryClubColor,
  clubBarGradient,
  contrastRatio,
  passesAATextOn,
} from '@/lib/site/clubColors';

describe('parseClubColors', () => {
  it('parses two distinct named colours', () => {
    const parsed = parseClubColors('Claret / Sky Blue');
    expect(parsed).toEqual([CLUB_COLOR_HEX['claret'], CLUB_COLOR_HEX['sky blue']]);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]).not.toBe(parsed?.[1]);
  });

  it('keeps only the first two of a three-token value (17 of 96 live rows carry a third token)', () => {
    const parsed = parseClubColors('Red / White / Black');
    expect(parsed).toEqual([CLUB_COLOR_HEX['red'], CLUB_COLOR_HEX['white']]);
  });

  it('parses a single-colour value to one hex', () => {
    const parsed = parseClubColors('Blue');
    expect(parsed).toEqual([CLUB_COLOR_HEX['blue']]);
    expect(parsed).toHaveLength(1);
  });

  it('fails the whole value on one unknown token, never a partial result', () => {
    expect(parseClubColors('Turquoise / White')).toBeNull();
  });

  it('returns null for empty, null, undefined, or whitespace-only input', () => {
    expect(parseClubColors('')).toBeNull();
    expect(parseClubColors(null)).toBeNull();
    expect(parseClubColors(undefined)).toBeNull();
    expect(parseClubColors('   ')).toBeNull();
  });

  it('collapses two tokens resolving to the same hex into a single-colour result', () => {
    // "Blue" and "Blue" both resolve to CLUB_COLOR_HEX.blue — a degenerate
    // two-stop gradient with identical stops is never useful.
    const parsed = parseClubColors('Blue / Blue');
    expect(parsed).toEqual([CLUB_COLOR_HEX['blue']]);
    expect(parsed).toHaveLength(1);
  });
});

describe('primaryClubColor', () => {
  it('returns the first-listed colour', () => {
    expect(primaryClubColor('Claret / Sky Blue')).toBe(CLUB_COLOR_HEX['claret']);
  });

  it('returns null when unparseable', () => {
    expect(primaryClubColor('Turquoise')).toBeNull();
  });
});

describe('clubBarGradient', () => {
  it('builds a real two-stop gradient when both clubs parse', () => {
    const gradient = clubBarGradient('Claret / Sky Blue', 'Red / White');
    expect(gradient).toBe(
      `linear-gradient(to bottom, ${CLUB_COLOR_HEX['claret']}, ${CLUB_COLOR_HEX['red']})`,
    );
  });

  it('fades the one parsed colour to var(--line) when only one club parses', () => {
    const gradient = clubBarGradient('Claret / Sky Blue', 'Turquoise');
    expect(gradient).toBe(`linear-gradient(to bottom, ${CLUB_COLOR_HEX['claret']}, var(--line))`);
  });

  it('fades var(--line) to the one parsed colour when only the away club parses', () => {
    const gradient = clubBarGradient('Turquoise', 'Red / White');
    expect(gradient).toBe(`linear-gradient(to bottom, var(--line), ${CLUB_COLOR_HEX['red']})`);
  });

  it('returns null when neither club parses', () => {
    expect(clubBarGradient('Turquoise', 'Magenta')).toBeNull();
  });

  it('returns null when both are missing', () => {
    expect(clubBarGradient(null, undefined)).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('is 1 for identical colours', () => {
    expect(contrastRatio('#8A2846', '#8A2846')).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#0C1512', '#EEF2ED')).toBeCloseTo(contrastRatio('#EEF2ED', '#0C1512'), 10);
  });
});

describe('passesAATextOn', () => {
  it('passes for black on white', () => {
    expect(passesAATextOn('#000000', '#FFFFFF')).toBe(true);
  });

  it('fails for a known-failing pair (yellow on near-white)', () => {
    // Both light colours: yellow kit hex against the near-white brand white
    // sits well below the 4.5:1 AA floor for text.
    expect(passesAATextOn(CLUB_COLOR_HEX['yellow']!, CLUB_COLOR_HEX['white']!)).toBe(false);
  });
});
