import { describe, it, expect } from 'vitest';
import { buildTaggingIndex, tagHeadline, tagHeadlines, type TaggableClub } from '@/lib/ingest/newsTagging';

const PL = 14;
const PD = 15;
const BL1 = 17;

const CLUBS: TaggableClub[] = [
  { id: 1, name: 'Arsenal FC', short_name: 'Arsenal', tla: 'ARS', league_id: PL },
  { id: 2, name: 'Manchester United FC', short_name: 'Man United', tla: 'MUN', league_id: PL },
  { id: 3, name: 'Real Madrid CF', short_name: 'Real Madrid', tla: 'RMA', league_id: PD },
  { id: 4, name: 'FC Barcelona', short_name: 'Barcelona', tla: 'FCB', league_id: PD },
  { id: 5, name: 'FC Bayern München', short_name: 'Bayern', tla: 'FCB', league_id: BL1 },
  // Relegated: retained for historical tables, so no current competition.
  { id: 6, name: 'Ipswich Town FC', short_name: 'Ipswich', tla: 'IPS', league_id: null },
];

const index = buildTaggingIndex(CLUBS);
const leagueOf = (id: number) => CLUBS.find((c) => c.id === id)?.league_id ?? null;
const tag = (title: string) => tagHeadline(title, index, leagueOf);

describe('tagHeadline', () => {
  it('tags the club a headline names, with its competition', () => {
    expect(tag('Arsenal complete deal for a defender')).toEqual({ team_ids: [1], league_id: PL });
  });

  it('tags every club named, not just the first', () => {
    expect(tag('Arsenal beat Manchester United at the Emirates'))
      .toEqual({ team_ids: [1, 2], league_id: PL });
  });

  it('leaves the competition null when the clubs span two of them', () => {
    // A European tie belongs to neither domestic league.
    expect(tag('Real Madrid draw Arsenal in the quarter-final'))
      .toEqual({ team_ids: [1, 3], league_id: null });
  });

  it('tags nothing for football this site does not cover', () => {
    expect(tag('Vozinha granted shirt name exemption by Chile FA'))
      .toEqual({ team_ids: [], league_id: null });
  });

  it('tags a relegated club but claims no competition for it', () => {
    expect(tag('Ipswich Town appoint a new manager')).toEqual({ team_ids: [6], league_id: null });
  });

  it('refuses to guess on an ambiguous three-letter code', () => {
    // "FCB" is Barcelona and Bayern in the stored data. Tagging both would
    // put a Bayern story on Barcelona's page; tagging one is a coin flip.
    expect(tag('FCB confirm the signing')).toEqual({ team_ids: [], league_id: null });
  });

  it('still tags an unambiguous code', () => {
    expect(tag('ARS 2-0 MUN: five things we learned')).toEqual({ team_ids: [1, 2], league_id: PL });
  });

  it('never matches a club name inside a longer word', () => {
    // The substring bug this project has shipped twice.
    expect(tag('Romania name their squad')).toEqual({ team_ids: [], league_id: null });
  });

  it('returns ids in a stable order regardless of where they appear', () => {
    expect(tag('Manchester United host Arsenal').team_ids).toEqual([1, 2]);
    expect(tag('Arsenal travel to Manchester United').team_ids).toEqual([1, 2]);
  });
});

describe('tagHeadlines', () => {
  it('tags a batch, preserving each item\'s own fields', () => {
    const items = [
      { title: 'Arsenal sign a goalkeeper', url: 'https://example.com/1' },
      { title: 'Copa Libertadores draw made', url: 'https://example.com/2' },
    ];
    expect(tagHeadlines(items, CLUBS)).toEqual([
      { title: 'Arsenal sign a goalkeeper', url: 'https://example.com/1', team_ids: [1], league_id: PL },
      { title: 'Copa Libertadores draw made', url: 'https://example.com/2', team_ids: [], league_id: null },
    ]);
  });

  it('handles an empty club list without tagging anything', () => {
    expect(tagHeadlines([{ title: 'Arsenal sign a goalkeeper' }], []))
      .toEqual([{ title: 'Arsenal sign a goalkeeper', team_ids: [], league_id: null }]);
  });
});
