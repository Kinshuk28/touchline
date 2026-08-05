import { describe, it, expect } from 'vitest';
import { getCompetitionMeta, KNOWN_COMPETITION_CODES } from '@/lib/site/competition';

describe('getCompetitionMeta', () => {
  it('maps every top-five fd_code to its own colour and display name', () => {
    expect(getCompetitionMeta('PL')).toEqual({
      code: 'PL', name: 'Premier League', bgClass: 'bg-comp-pl', textClass: 'text-comp-pl', borderClass: 'border-comp-pl', hoverTextClass: 'hover:text-comp-pl',
    });
    expect(getCompetitionMeta('PD')).toEqual({
      code: 'PD', name: 'La Liga', bgClass: 'bg-comp-pd', textClass: 'text-comp-pd', borderClass: 'border-comp-pd', hoverTextClass: 'hover:text-comp-pd',
    });
    expect(getCompetitionMeta('SA')).toEqual({
      code: 'SA', name: 'Serie A', bgClass: 'bg-comp-sa', textClass: 'text-comp-sa', borderClass: 'border-comp-sa', hoverTextClass: 'hover:text-comp-sa',
    });
    expect(getCompetitionMeta('BL1')).toEqual({
      code: 'BL1', name: 'Bundesliga', bgClass: 'bg-comp-bl1', textClass: 'text-comp-bl1', borderClass: 'border-comp-bl1', hoverTextClass: 'hover:text-comp-bl1',
    });
    expect(getCompetitionMeta('FL1')).toEqual({
      code: 'FL1', name: 'Ligue 1', bgClass: 'bg-comp-fl1', textClass: 'text-comp-fl1', borderClass: 'border-comp-fl1', hoverTextClass: 'hover:text-comp-fl1',
    });
  });

  it('every known mapping resolves to a distinct colour class', () => {
    const classes = KNOWN_COMPETITION_CODES.map((code) => getCompetitionMeta(code).bgClass);
    expect(new Set(classes).size).toBe(classes.length);
  });

  // An unmapped fd_code must never invent a colour — it falls back to
  // --muted, per the redesign spec's "A league with no mapping falls back
  // to --muted, never an invented colour."
  it('falls back to muted for an unmapped code, never inventing a colour', () => {
    expect(getCompetitionMeta('XYZ')).toEqual({
      code: 'XYZ', name: 'Other competition', bgClass: 'bg-muted', textClass: 'text-muted', borderClass: 'border-muted', hoverTextClass: 'hover:text-text',
    });
  });

  it('falls back to muted for an empty code', () => {
    const meta = getCompetitionMeta('');
    expect(meta.bgClass).toBe('bg-muted');
    expect(meta.name).toBe('Other competition');
  });
});
