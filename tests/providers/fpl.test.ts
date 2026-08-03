import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FplClient } from '@/lib/providers/fpl';

const bootstrap = JSON.parse(readFileSync('tests/fixtures/fpl-bootstrap.json', 'utf8'));

function clientFor(body: unknown) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  return new FplClient({ fetchImpl });
}

describe('FplClient.getPlayers', () => {
  it('returns every player with statistics', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    expect(players.length).toBeGreaterThan(400);
    const p = players[0]!;
    expect(typeof p.fplId).toBe('number');
    expect(p.name).toBeTruthy();
    expect(typeof p.minutes).toBe('number');
  });

  it('maps element_type to a readable position', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    const positions = new Set(players.map((p) => p.position));
    for (const pos of positions) {
      expect(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']).toContain(pos);
    }
  });

  it('builds a photo URL from the photo code', async () => {
    const players = await clientFor(bootstrap).getPlayers();
    const withPhoto = players.find((p) => p.photoUrl !== null)!;
    expect(withPhoto.photoUrl).toMatch(/^https:\/\/resources\.premierleague\.com\/.*\.png$/);
    expect(withPhoto.photoUrl).not.toContain('.jpg');
  });

  it('returns null rather than 0 when expected_goals is absent', async () => {
    const players = await clientFor({
      elements: [{ id: 1, first_name: 'A', second_name: 'B', web_name: 'AB', team: 1, element_type: 3, minutes: 90, goals_scored: 1, assists: 0, photo: '1.jpg' }],
      teams: [], events: [],
    }).getPlayers();
    expect(players[0]!.expectedGoals).toBeNull();
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(new FplClient({ fetchImpl }).getPlayers()).rejects.toThrow(/503/);
  });

  it('maps exact field values for a real player, guarding against stat swaps', async () => {
    // Fixture element id 4 ("Gabriel dos Santos Magalhães") has distinct
    // minutes/goals/assists (2750/3/5) so a swap between any two of these
    // fields would fail this assertion, unlike a bare typeof check.
    const raw = bootstrap.elements.find((e: { id: number }) => e.id === 4);
    expect(raw).toBeDefined();
    expect(raw.minutes).toBe(2750);
    expect(raw.goals_scored).toBe(3);
    expect(raw.assists).toBe(5);

    const players = await clientFor(bootstrap).getPlayers();
    const gabriel = players.find((p) => p.fplId === 4)!;
    expect(gabriel).toBeDefined();
    expect(gabriel.name).toBe('Gabriel dos Santos Magalhães');
    expect(gabriel.webName).toBe('Gabriel');
    expect(gabriel.teamFplId).toBe(1);
    expect(gabriel.position).toBe('Defender');
    expect(gabriel.minutes).toBe(2750);
    expect(gabriel.goals).toBe(3);
    expect(gabriel.assists).toBe(5);
    expect(gabriel.expectedGoals).toBe(2.94);
    expect(gabriel.photoUrl).toBe(
      'https://resources.premierleague.com/premierleague/photos/players/250x250/p226597.png',
    );
  });

  it('returns 0 rather than null when expected_goals is present and zero', async () => {
    // Fixture element id 1 (David Raya Martín) has expected_goals: "0.00".
    // This guards against the regression xg || null, which would turn 0 into null.
    const raw = bootstrap.elements.find((e: { id: number }) => e.id === 1);
    expect(raw).toBeDefined();
    expect(raw!.expected_goals).toBe('0.00');

    const players = await clientFor(bootstrap).getPlayers();
    const raya = players.find((p) => p.fplId === 1)!;
    expect(raya).toBeDefined();
    expect(raya.expectedGoals).toBe(0);
    expect(raya.expectedGoals).not.toBeNull();
  });

  it('returns null rather than 0 when minutes/goals/assists are absent from the payload', async () => {
    // Mirrors the expected_goals regression test above: `?? 0` on these three
    // fields would turn "the provider didn't send this field" into an
    // authoritative "this player has 0 minutes / goals / assists" — exactly
    // the fabrication the product must never commit.
    const players = await clientFor({
      elements: [
        { id: 901, first_name: 'No', second_name: 'Stats', web_name: 'NoStats', team: 1, element_type: 2 },
      ],
      teams: [], events: [],
    }).getPlayers();
    const p = players.find((pl) => pl.fplId === 901)!;
    expect(p).toBeDefined();
    expect(p.minutes).toBeNull();
    expect(p.goals).toBeNull();
    expect(p.assists).toBeNull();
  });

  it('returns a real 0 (not null) when minutes/goals/assists are present and zero', async () => {
    // The other half of the same regression: a real, reported zero must
    // survive as 0, not be swallowed into null by an overly broad fix.
    const players = await clientFor({
      elements: [
        {
          id: 902, first_name: 'Zero', second_name: 'Stats', web_name: 'ZeroStats',
          team: 1, element_type: 2, minutes: 0, goals_scored: 0, assists: 0,
        },
      ],
      teams: [], events: [],
    }).getPlayers();
    const p = players.find((pl) => pl.fplId === 902)!;
    expect(p).toBeDefined();
    expect(p.minutes).toBe(0);
    expect(p.goals).toBe(0);
    expect(p.assists).toBe(0);
  });

  it('skips elements whose element_type is not a known playing position (e.g. a manager, element_type 5) instead of storing them with a guessed position', async () => {
    // FPL's bootstrap-static adds element_type 5 for fantasy managers in
    // seasons where manager scoring exists. Storing that row as a player
    // with position 'Unknown' would fabricate data; the correct behaviour
    // is to not create a player row for it at all.
    const players = await clientFor({
      elements: [
        { id: 903, first_name: 'Real', second_name: 'Player', web_name: 'RP', team: 1, element_type: 3 },
        { id: 904, first_name: 'Some', second_name: 'Manager', web_name: 'SM', team: 1, element_type: 5 },
      ],
      teams: [], events: [],
    }).getPlayers();
    expect(players.some((p) => p.fplId === 903)).toBe(true);
    expect(players.some((p) => p.fplId === 904)).toBe(false);
    expect(players).toHaveLength(1);
  });
});

describe('FplClient.getBootstrap', () => {
  it('returns the 20 Premier League clubs alongside the players, from a single fetch', async () => {
    const { players, teams } = await clientFor(bootstrap).getBootstrap();
    expect(teams).toHaveLength(20);
    const arsenal = teams.find((t) => t.name === 'Arsenal')!;
    expect(arsenal).toBeDefined();
    expect(arsenal.fplId).toBe(1);
    expect(arsenal.shortName).toBe('ARS');
    expect(players.length).toBeGreaterThan(400);
  });
});
