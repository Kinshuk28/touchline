import { describe, it, expect } from 'vitest';
import { buildClubIndex, isRelevantHeadline, orderByRelevance, type ClubNameSource } from '@/lib/site/newsRelevance';
import type { NewsRow } from '@/lib/site/rows';

/**
 * A slice of the real `teams` table — stored `name`/`short_name`/`tla`
 * exactly as football-data.org supplies them, including the club-form
 * noise ("FC", "AS", "Bayer 04") and the diacritics the matcher has to
 * survive. Small on purpose: every awkward shape the 110 live rows contain
 * is represented, nothing is here just to pad the list.
 */
const CLUBS: ClubNameSource[] = [
  { name: 'Arsenal FC', short_name: 'Arsenal', tla: 'ARS' },
  { name: 'Manchester United FC', short_name: 'Man United', tla: 'MUN' },
  { name: 'Nottingham Forest FC', short_name: 'Nottingham', tla: 'NOT' },
  { name: 'Real Madrid CF', short_name: 'Real Madrid', tla: 'RMA' },
  { name: 'Club Atlético de Madrid', short_name: 'Atleti', tla: 'ATL' },
  { name: 'Bayer 04 Leverkusen', short_name: 'Leverkusen', tla: 'B04' },
  { name: 'FC Bayern München', short_name: 'Bayern', tla: 'FCB' },
  { name: 'AS Roma', short_name: 'Roma', tla: 'ROM' },
  { name: 'OGC Nice', short_name: 'Nice', tla: 'NIC' },
  { name: 'RC Lens', short_name: 'Lens', tla: 'RCL' },
  { name: 'Paris Saint-Germain FC', short_name: 'PSG', tla: 'PSG' },
];

const index = buildClubIndex(CLUBS);

function row(overrides: Partial<NewsRow> & { id: number; title: string }): NewsRow {
  return {
    source: 'BBC Sport',
    summary: null,
    url: `https://example.com/${overrides.id}`,
    image_url: null,
    published_at: '2026-08-04T12:00:00Z',
    categories: [],
    ...overrides,
  };
}

describe('isRelevantHeadline', () => {
  it('matches a stored full name', () => {
    expect(isRelevantHeadline('Manchester United agree deal for defender', index)).toBe(true);
  });

  it('matches a stored short name', () => {
    expect(isRelevantHeadline('Atleti confirm the signing', index)).toBe(true);
  });

  it('matches a stored TLA', () => {
    expect(isRelevantHeadline('PSG 3-1 Lyon: five things we learned', index)).toBe(true);
  });

  it('matches a name whose stored form carries club-form noise the headline drops', () => {
    // Stored "AS Roma" / "Bayer 04 Leverkusen" / "FC Bayern München" — a
    // headline never writes them that way.
    expect(isRelevantHeadline('Roma close on a striker', index)).toBe(true);
    expect(isRelevantHeadline('Bayer Leverkusen hold on at home', index)).toBe(true);
    expect(isRelevantHeadline('Bayern make their move', index)).toBe(true);
  });

  it('survives diacritics in either direction', () => {
    expect(isRelevantHeadline('Bayern München win again', index)).toBe(true);
    expect(isRelevantHeadline('Atlético de Madrid draw at home', index)).toBe(true);
  });

  it('rejects a global-football headline that names no stored club', () => {
    // The exact story the deployed site led with, which is what this whole
    // module exists to stop.
    expect(isRelevantHeadline('Vozinha granted shirt name exemption by Chile FA', index)).toBe(false);
  });

  // ---- The bug this project has shipped twice: substring matching. ----

  it('never matches a club name inside a longer word', () => {
    // "Nice" inside "Hornicek" — the original defect, verbatim.
    expect(isRelevantHeadline('Hornicek keeps a clean sheet on debut', index)).toBe(false);
    // "Lens" inside "Lensman", "Roma" inside "Romania", "Arsenal" inside a
    // hyphen-free compound.
    expect(isRelevantHeadline('Lensman of the year announced', index)).toBe(false);
    expect(isRelevantHeadline('Romania name their squad', index)).toBe(false);
  });

  it('never matches a TLA inside a longer word', () => {
    // "ARS" inside "ARSENALGATE" is a whole different token; "NOT" inside
    // "NOTHING" likewise. Case-sensitive whole-token matching is what makes
    // both safe.
    expect(isRelevantHeadline('NOTHING TO SEPARATE THEM AT THE TOP', index)).toBe(false);
  });

  it('does not treat an ordinary lower-case word as a one-word club name', () => {
    // OGC Nice and RC Lens are stored clubs; "nice" and "lens" are also
    // ordinary words. Case-sensitivity for single-token aliases is the rule
    // that separates them.
    expect(isRelevantHeadline('A nice finish from the substitute', index)).toBe(false);
    expect(isRelevantHeadline('Referee checks the pitchside lens again', index)).toBe(false);
  });

  it('still matches those clubs when the headline capitalises them properly', () => {
    expect(isRelevantHeadline('Nice hold on at Marseille', index)).toBe(true);
    expect(isRelevantHeadline('Lens go second in Ligue 1', index)).toBe(true);
  });

  it('is case-insensitive for multi-word names, where two specific words in a row are signal enough', () => {
    expect(isRelevantHeadline('real madrid win the derby', index)).toBe(true);
  });

  it('handles an empty or punctuation-only headline without matching anything', () => {
    expect(isRelevantHeadline('', index)).toBe(false);
    expect(isRelevantHeadline('— … —', index)).toBe(false);
  });

  it('builds an index that matches nothing when there are no clubs', () => {
    const empty = buildClubIndex([]);
    expect(isRelevantHeadline('Arsenal sign a goalkeeper', empty)).toBe(false);
  });

  it('ignores a stored TLA that is not three upper-case letters', () => {
    const odd = buildClubIndex([{ name: 'Some Club', short_name: null, tla: 'ab' }]);
    expect(isRelevantHeadline('AB testing the new kit', odd)).toBe(false);
  });
});

describe('orderByRelevance', () => {
  it('puts relevant headlines first and keeps recency inside each group', () => {
    const items = [
      row({ id: 1, title: 'Vozinha granted shirt name exemption by Chile FA' }),
      row({ id: 2, title: 'Arsenal close in on a deadline-day move' }),
      row({ id: 3, title: 'Copa Libertadores last-16 draw made' }),
      row({ id: 4, title: 'Real Madrid held at Getafe' }),
    ];
    expect(orderByRelevance(items, index).map((i) => i.id)).toEqual([2, 4, 1, 3]);
  });

  it('sinks a promo title below real stories without dropping it', () => {
    const items = [
      row({ id: 1, title: 'Get Arsenal score updates on your lock screen' }),
      row({ id: 2, title: 'Arsenal beat Chelsea in the derby' }),
    ];
    expect(orderByRelevance(items, index).map((i) => i.id)).toEqual([2, 1]);
  });

  it('never returns an empty list when nothing is relevant — recency stands in', () => {
    const items = [
      row({ id: 1, title: 'Chile FA clears the way for a shirt name' }),
      row({ id: 2, title: 'Copa Libertadores draw made' }),
    ];
    expect(orderByRelevance(items, index).map((i) => i.id)).toEqual([1, 2]);
  });

  it('applies the limit after ordering, so a relevant item beyond the cut still makes the rail', () => {
    const items = [
      row({ id: 1, title: 'Chile FA clears the way for a shirt name' }),
      row({ id: 2, title: 'Copa Libertadores draw made' }),
      row({ id: 3, title: 'Roma sign a striker' }),
    ];
    expect(orderByRelevance(items, index, 2).map((i) => i.id)).toEqual([3, 1]);
  });

  it('returns the same objects, never rewritten copies', () => {
    const only = row({ id: 1, title: 'Arsenal sign a goalkeeper' });
    expect(orderByRelevance([only], index)[0]).toBe(only);
  });

  it('preserves the caller\'s row type — a transfer row keeps its league_id', () => {
    const transfer = { ...row({ id: 1, title: 'Roma sign a striker' }), league_id: 16 };
    const [first] = orderByRelevance([transfer], index);
    expect(first?.league_id).toBe(16);
  });
});
