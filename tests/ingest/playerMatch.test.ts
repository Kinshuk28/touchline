import { describe, it, expect } from 'vitest';
import { matchPlayersTiered, type MatchCandidate, type MatchSubject } from '@/lib/ingest/playerMatch';

describe('matchPlayersTiered', () => {
  // A realistic Arsenal-shaped club: several players whose legal and
  // display names coincide, plus the compound-legal-name cases this tiered
  // matcher exists for.
  const arsenal: MatchCandidate[] = [
    { id: 1, name: 'David Raya', teamId: 100 },
    { id: 2, name: 'Gabriel Magalhães', teamId: 100 },
    { id: 3, name: 'Mikel Merino', teamId: 100 },
    { id: 4, name: 'William Saliba', teamId: 100 },
  ];

  it('tier 1: matches on exact normalised full name', () => {
    const subject: MatchSubject = { fullName: 'William Saliba', webName: 'Saliba', teamId: 100 };
    const { matches, unmatched, tierCounts } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerId).toBe(4);
    expect(matches[0]!.tier).toBe('exact');
    expect(tierCounts).toEqual({ exact: 1, 'last-token': 0, 'whole-token': 0 });
    expect(unmatched).toHaveLength(0);
  });

  it('tier 2: matches web_name against the last token of the display name (David Raya Martín -> Raya)', () => {
    const subject: MatchSubject = { fullName: 'David Raya Martín', webName: 'Raya', teamId: 100 };
    const { matches, tierCounts } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerId).toBe(1);
    expect(matches[0]!.tier).toBe('last-token');
    expect(tierCounts['last-token']).toBe(1);
  });

  it('tier 2: matches web_name against the last token (Mikel Merino Zazón -> Merino)', () => {
    const subject: MatchSubject = { fullName: 'Mikel Merino Zazón', webName: 'Merino', teamId: 100 };
    const { matches } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerId).toBe(3);
    expect(matches[0]!.tier).toBe('last-token');
  });

  it('tier 3: matches web_name against a non-last whole token (Gabriel dos Santos Magalhães -> Gabriel)', () => {
    const subject: MatchSubject = { fullName: 'Gabriel dos Santos Magalhães', webName: 'Gabriel', teamId: 100 };
    const { matches, tierCounts } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerId).toBe(2);
    expect(matches[0]!.tier).toBe('whole-token');
    expect(tierCounts['whole-token']).toBe(1);
  });

  it('reports, rather than guesses, an ambiguous within-club surname (two "Silva"s at the same club)', () => {
    const club: MatchCandidate[] = [
      { id: 10, name: 'Fabio Silva', teamId: 200 },
      { id: 11, name: 'Thiago Silva', teamId: 200 },
    ];
    const subject: MatchSubject = { fullName: 'Someone Else Silva', webName: 'Silva', teamId: 200 };
    const { matches, unmatched } = matchPlayersTiered([subject], club);
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toBe(subject);
  });

  it('reports unmatched when the club has no candidates at all', () => {
    const subject: MatchSubject = { fullName: 'Nobody Here', webName: 'Nobody', teamId: 999 };
    const { matches, unmatched } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('never matches across a club boundary, even when another club has an exact name+web_name match', () => {
    // Same person-shaped name sitting at a different club (teamId 300) must
    // not satisfy a subject scoped to club 100.
    const otherClub: MatchCandidate[] = [{ id: 50, name: 'William Saliba', teamId: 300 }];
    const subject: MatchSubject = { fullName: 'William Saliba', webName: 'Saliba', teamId: 100 };
    const { matches, unmatched } = matchPlayersTiered([subject], otherClub);
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('reports unmatched, not a guess, when the subject has no resolved teamId at all', () => {
    const subject: MatchSubject = { fullName: 'William Saliba', webName: 'Saliba', teamId: undefined };
    const { matches, unmatched } = matchPlayersTiered([subject], arsenal);
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('falls through a tier 1 miss to a resolving lower tier', () => {
    // No candidate shares an exact full-name-normalised form with the
    // subject (tier 1 empty), but exactly one candidate's last token
    // matches the web_name — tier 2 resolves it.
    const club: MatchCandidate[] = [
      { id: 22, name: 'Jorge Silva', teamId: 401 },
      { id: 23, name: 'Andre Gomes', teamId: 401 },
    ];
    const subject: MatchSubject = { fullName: 'Jorge Miguel Silva', webName: 'Silva', teamId: 401 };
    const { matches } = matchPlayersTiered([subject], club);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerId).toBe(22);
    expect(matches[0]!.tier).toBe('last-token');
  });

  it('tallies tier counts correctly across a mixed batch', () => {
    const subjects: MatchSubject[] = [
      { fullName: 'William Saliba', webName: 'Saliba', teamId: 100 }, // exact
      { fullName: 'David Raya Martín', webName: 'Raya', teamId: 100 }, // last-token
      { fullName: 'Gabriel dos Santos Magalhães', webName: 'Gabriel', teamId: 100 }, // whole-token
      { fullName: 'Nobody Real', webName: 'Nobody', teamId: 100 }, // unmatched
    ];
    const { matches, unmatched, tierCounts } = matchPlayersTiered(subjects, arsenal);
    expect(matches).toHaveLength(3);
    expect(unmatched).toHaveLength(1);
    expect(tierCounts).toEqual({ exact: 1, 'last-token': 1, 'whole-token': 1 });
  });
});
