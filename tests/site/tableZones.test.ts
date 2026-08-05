import { describe, it, expect } from 'vitest';
import { relegationZones, zoneKindForPosition } from '@/lib/site/tableZones';

describe('relegationZones', () => {
  it('marks a flat three-team drop for the Premier League, La Liga and Serie A', () => {
    for (const code of ['PL', 'PD', 'SA']) {
      expect(relegationZones(code, 20)).toEqual([{ afterPosition: 17, label: 'Relegation', kind: 'relegation' }]);
    }
  });

  it('marks Bundesliga with a separate play-off boundary above the automatic one', () => {
    expect(relegationZones('BL1', 18)).toEqual([
      { afterPosition: 15, label: 'Relegation play-off', kind: 'relegation-playoff' },
      { afterPosition: 16, label: 'Relegation', kind: 'relegation' },
    ]);
  });

  // Deliberately a single generic zone, no automatic/play-off split — see
  // the module doc comment for why: Ligue 1's exact split after shrinking
  // to 18 clubs isn't something this build asserts with confidence.
  it('marks Ligue 1 with one generic relegation zone, no play-off split', () => {
    expect(relegationZones('FL1', 18)).toEqual([{ afterPosition: 15, label: 'Relegation zone', kind: 'relegation' }]);
  });

  it('never draws a European-qualification boundary for any of the five, at any team count', () => {
    for (const code of ['PL', 'PD', 'SA', 'BL1', 'FL1']) {
      const zones = relegationZones(code, 20);
      expect(zones.every((z) => z.kind === 'relegation' || z.kind === 'relegation-playoff')).toBe(true);
    }
  });

  it('returns nothing for an unmapped competition code', () => {
    expect(relegationZones('XX', 20)).toEqual([]);
  });

  it('returns nothing when there are fewer than 3 teams — no boundary makes sense', () => {
    expect(relegationZones('PL', 2)).toEqual([]);
  });
});

describe('zoneKindForPosition', () => {
  const bl1Zones = relegationZones('BL1', 18);

  it('resolves the play-off spot for position 16', () => {
    expect(zoneKindForPosition(bl1Zones, 16)).toBe('relegation-playoff');
  });

  it('resolves automatic relegation for positions 17 and 18', () => {
    expect(zoneKindForPosition(bl1Zones, 17)).toBe('relegation');
    expect(zoneKindForPosition(bl1Zones, 18)).toBe('relegation');
  });

  it('resolves null above the zone', () => {
    expect(zoneKindForPosition(bl1Zones, 15)).toBeNull();
    expect(zoneKindForPosition(bl1Zones, 1)).toBeNull();
  });

  it('resolves the flat relegation kind for a three-team-drop competition', () => {
    const plZones = relegationZones('PL', 20);
    expect(zoneKindForPosition(plZones, 18)).toBe('relegation');
    expect(zoneKindForPosition(plZones, 17)).toBeNull();
  });
});
