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
});
