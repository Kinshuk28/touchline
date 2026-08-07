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

describe('FplClient.getGameweekLive', () => {
  const line = {
    id: 11,
    stats: {
      minutes: 90, goals_scored: 2, assists: 1, clean_sheets: 1, goals_conceded: 0,
      own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 1,
      red_cards: 0, saves: 0, bonus: 3, total_points: 16,
    },
  };

  it('maps one gameweek stat line, keeping FPL total_points as published', async () => {
    const [mapped] = await clientFor({ elements: [line] }).getGameweekLive(7);
    expect(mapped).toEqual({
      fplId: 11, gameweek: 7, minutes: 90, goals: 2, assists: 1, cleanSheets: 1,
      goalsConceded: 0, ownGoals: 0, penaltiesSaved: 0, penaltiesMissed: 0,
      yellowCards: 1, redCards: 0, saves: 0, bonus: 3, totalPoints: 16,
    });
  });

  it('does not recompute total_points from the component stats', async () => {
    // FPL's own rules change between seasons; a figure derived here would be
    // a second source of truth. Given a total that no rule set would produce
    // from these components, the stored figure is still FPL's.
    const [mapped] = await clientFor({
      elements: [{ id: 12, stats: { ...line.stats, total_points: 99 } }],
    }).getGameweekLive(7);
    expect(mapped!.totalPoints).toBe(99);
  });

  it('returns null, not 0, for stats the payload omits', async () => {
    const [mapped] = await clientFor({ elements: [{ id: 13, stats: { minutes: 45 } }] }).getGameweekLive(1);
    expect(mapped!.minutes).toBe(45);
    expect(mapped!.totalPoints).toBeNull();
    expect(mapped!.goals).toBeNull();
    expect(mapped!.bonus).toBeNull();
  });

  it('keeps a published zero as 0', async () => {
    const [mapped] = await clientFor({
      elements: [{ id: 14, stats: { minutes: 0, total_points: 0 } }],
    }).getGameweekLive(1);
    expect(mapped!.minutes).toBe(0);
    expect(mapped!.totalPoints).toBe(0);
  });

  it('stamps the requested gameweek onto every line', async () => {
    const lines = await clientFor({ elements: [{ id: 1 }, { id: 2 }] }).getGameweekLive(38);
    expect(lines.map((l) => l.gameweek)).toEqual([38, 38]);
  });

  it('returns an empty list when the payload carries no elements', async () => {
    expect(await clientFor({}).getGameweekLive(1)).toEqual([]);
  });

  it('rejects a gameweek that is not a positive integer, before making a request', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new FplClient({ fetchImpl });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(client.getGameweekLive(bad)).rejects.toThrow(/positive integer/);
    }
    expect(calls).toBe(0);
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch;
    await expect(new FplClient({ fetchImpl }).getGameweekLive(3)).rejects.toThrow(/500/);
  });
});

describe('FplClient.getBootstrap — the gameweek calendar', () => {
  it('returns the season’s gameweeks alongside players and teams', async () => {
    const { events } = await clientFor(bootstrap).getBootstrap();
    expect(events).toHaveLength(38);
    expect(events[0]).toMatchObject({ id: 1, name: 'Gameweek 1', isNext: true, finished: false });
    expect(events[0]!.deadlineTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reads finished and data_checked as the separate flags they are', async () => {
    const { events } = await clientFor({
      elements: [], teams: [],
      events: [
        { id: 1, name: 'Gameweek 1', finished: true, data_checked: true },
        { id: 2, name: 'Gameweek 2', finished: true, data_checked: false },
      ],
    }).getBootstrap();
    expect(events.map((e) => [e.finished, e.dataChecked])).toEqual([[true, true], [true, false]]);
  });

  it('defaults a missing flag to false rather than dropping the gameweek', async () => {
    // An absent data_checked must read as "not settled": that makes ingest
    // re-fetch the week, where the opposite would freeze provisional points.
    const { events } = await clientFor({ elements: [], teams: [], events: [{ id: 5 }] }).getBootstrap();
    expect(events[0]).toEqual({
      id: 5, name: 'Gameweek 5', deadlineTime: null,
      finished: false, dataChecked: false, isCurrent: false, isNext: false,
    });
  });

  it('returns an empty calendar rather than throwing when FPL sends no events', async () => {
    expect((await clientFor({ elements: [], teams: [] }).getBootstrap()).events).toEqual([]);
  });
});
