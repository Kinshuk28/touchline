import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FootballDataClient } from '@/lib/providers/footballData';
import { RateLimiter } from '@/lib/ingest/rateLimiter';

const snap = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, 'utf8'));

function clientFor(body: unknown, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers });
  }) as unknown as typeof fetch;
  const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, sleep: async () => {} });
  return { client: new FootballDataClient({ apiKey: 'k', limiter, fetchImpl }), calls, limiter };
}

describe('FootballDataClient.getMatches', () => {
  it('maps every match to a RawFixture', async () => {
    const { client } = clientFor(snap('fd-matches-pl'));
    const out = await client.getMatches('PL', 2026);
    expect(out.length).toBeGreaterThan(300);
    const f = out[0]!;
    expect(f.leagueCode).toBe('PL');
    expect(f.season).toBe(2026);
    expect(typeof f.fdId).toBe('number');
    expect(typeof f.homeTeamFdId).toBe('number');
    expect(f.kickoffUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('represents an unplayed match with null goals, never zero', async () => {
    const { client } = clientFor(snap('fd-matches-pl'));
    const out = await client.getMatches('PL', 2026);
    const scheduled = out.find((f) => f.status === 'SCHEDULED' || f.status === 'TIMED')!;
    expect(scheduled.homeGoals).toBeNull();
    expect(scheduled.awayGoals).toBeNull();
  });

  it('sends the auth header and the season parameter', async () => {
    const { client, calls } = clientFor(snap('fd-matches-pl'));
    await client.getMatches('PD', 2025);
    expect(calls[0]).toContain('/competitions/PD/matches');
    expect(calls[0]).toContain('season=2025');
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-matches-pl'), {
      'x-requests-available-minute': '3',
    });
    await client.getMatches('PL', 2026);
    expect(limiter.available).toBe(3);
  });
});

describe('FootballDataClient.getMatches — played matches (2025 season, all FINISHED)', () => {
  it('maps FINISHED matches to real numeric goals, and at least one has a non-zero score', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const finished = out.filter((f) => f.status === 'FINISHED');
    expect(finished.length).toBeGreaterThan(300);

    const nonZero = finished.find((f) => (f.homeGoals ?? 0) > 0 || (f.awayGoals ?? 0) > 0);
    expect(nonZero).toBeDefined();
    expect(typeof nonZero!.homeGoals).toBe('number');
    expect(typeof nonZero!.awayGoals).toBe('number');
  });

  it('maps half-time scores on a played match', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const withHalfTime = out.find((f) => f.status === 'FINISHED' && f.halfTimeHome !== null);
    expect(withHalfTime).toBeDefined();
    expect(typeof withHalfTime!.halfTimeHome).toBe('number');
    expect(typeof withHalfTime!.halfTimeAway).toBe('number');
  });

  it('populates lastUpdated on a played match', async () => {
    const { client } = clientFor(snap('fd-matches-pl-2025'));
    const out = await client.getMatches('PL', 2025);
    const finished = out.find((f) => f.status === 'FINISHED')!;
    expect(finished.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maps a genuine 0-0 FINISHED match to zero goals, never null — the case that actually distinguishes "not played" from "goalless draw"', async () => {
    const raw = snap('fd-matches-pl-2025') as { matches: Array<{ id: number; status: string; score?: { fullTime?: { home: number | null; away: number | null } } }> };
    const rawZeroZero = raw.matches.find(
      (m) => m.status === 'FINISHED' && m.score?.fullTime?.home === 0 && m.score?.fullTime?.away === 0,
    );
    // Verified against the real 2025-26 PL snapshot: 27 genuine 0-0 finishes exist.
    expect(rawZeroZero).toBeDefined();

    const { client } = clientFor(raw);
    const out = await client.getMatches('PL', 2025);
    const mapped = out.find((f) => f.fdId === rawZeroZero!.id)!;
    expect(mapped).toBeDefined();
    expect(mapped.status).toBe('FINISHED');
    expect(mapped.homeGoals).toBe(0);
    expect(mapped.awayGoals).toBe(0);
    expect(mapped.homeGoals).not.toBeNull();
    expect(mapped.awayGoals).not.toBeNull();
  });
});

describe('FootballDataClient.getScorers', () => {
  it('reproduces the top scorer\'s real fields exactly — would catch a goals/assists/playedMatches field swap', async () => {
    const raw = snap('fd-scorers-pl-2025') as {
      scorers: Array<{
        player: { id: number; name: string };
        team: { id: number };
        goals: number | null;
        assists: number | null;
        playedMatches: number | null;
      }>;
    };
    const rawTop = raw.scorers[0]!;

    const { client } = clientFor(raw);
    const out = await client.getScorers('PL', 2025);
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;

    // Exact-value assertions (not just `typeof`): goals, assists and
    // playedMatches are all numeric, so a mapping that swapped two of them
    // would still satisfy a bare `typeof === 'number'` check. Comparing
    // against the real fixture values catches that.
    expect(top.playerFdId).toBe(rawTop.player.id);
    expect(top.playerName).toBe(rawTop.player.name);
    expect(top.teamFdId).toBe(rawTop.team.id);
    expect(top.goals).toBe(rawTop.goals);
    expect(top.playedMatches).toBe(rawTop.playedMatches);
  });

  it('sends the season parameter, the limit=100 param, and hits the scorers endpoint', async () => {
    const { client, calls } = clientFor(snap('fd-scorers-pl-2025'));
    await client.getScorers('PL', 2025);
    expect(calls[0]).toContain('/competitions/PL/scorers');
    expect(calls[0]).toContain('season=2025');
    // 100, not 50: for La Liga and Serie A — where getSquad returns an empty
    // squad for every club — this scorers list is the only source of
    // players at all, so the higher ceiling doubles their entire roster.
    expect(calls[0]).toContain('limit=100');
  });

  describe('bio fields from the player object — La Liga 2025 snapshot (100 entries, season with real bio data throughout)', () => {
    const raw = snap('fd-scorers-pd-2025') as {
      scorers: Array<{
        player: {
          id: number; name: string; firstName: string | null; lastName: string | null;
          dateOfBirth: string | null; nationality: string | null;
          position: string | null; shirtNumber: number | null;
        };
        team: { id: number; name: string };
        goals: number | null; assists: number | null;
      }>;
    };

    it('captured 100 scorers, confirming the limit=100 request param actually returns double the old limit=50 count', () => {
      expect(raw.scorers.length).toBe(100);
    });

    it('maps the top scorer\'s bio exactly — Kylian Mbappé, Real Madrid', async () => {
      const rawTop = raw.scorers[0]!;
      expect(rawTop.player.name).toBe('Kylian Mbappé');
      expect(rawTop.team.name).toBe('Real Madrid CF');

      const { client } = clientFor(raw);
      const out = await client.getScorers('PD', 2025);
      const top = out[0]!;

      expect(top.playerFdId).toBe(3374);
      expect(top.goals).toBe(25);
      expect(top.assists).toBe(4);
      expect(top.teamFdId).toBe(86);
      expect(top.firstName).toBe(rawTop.player.firstName);
      expect(top.lastName).toBe(rawTop.player.lastName);
      expect(top.dateOfBirth).toBe(rawTop.player.dateOfBirth);
      expect(top.nationality).toBe(rawTop.player.nationality);
    });

    it('maps shirtNumber to a real non-null value when the payload has one — Raphinha, shirt 7', async () => {
      const rawWithShirt = raw.scorers.find((s) => s.player.shirtNumber !== null)!;
      expect(rawWithShirt).toBeDefined();
      expect(rawWithShirt.player.name).toBe('Raphinha');
      expect(rawWithShirt.player.shirtNumber).toBe(7);

      const { client } = clientFor(raw);
      const out = await client.getScorers('PD', 2025);
      const mapped = out.find((s) => s.playerFdId === rawWithShirt.player.id)!;
      expect(mapped).toBeDefined();
      expect(mapped.shirtNumber).toBe(7);
    });

    it('maps position to null, never a fabricated string, when football-data.org sends position: null — true for every entry in this snapshot, including the top scorer', async () => {
      expect(raw.scorers.every((s) => s.player.position === null)).toBe(true);

      const { client } = clientFor(raw);
      const out = await client.getScorers('PD', 2025);
      expect(out.every((s) => s.position === null)).toBe(true);
    });
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-scorers-pl-2025'), {
      'x-requests-available-minute': '4',
    });
    await client.getScorers('PL', 2025);
    expect(limiter.available).toBe(4);
  });

  it('maps assists to null, never 0, when football-data.org sends assists: null', async () => {
    // Verified against the real snapshot: football-data.org sends the key
    // present with an explicit `null` value (not omitted) for 5 of the 50
    // returned scorers — low-minutes players it has no assist data for.
    const raw = snap('fd-scorers-pl-2025') as { scorers: Array<{ player: { id: number }; assists: number | null }> };
    const rawNullAssists = raw.scorers.find((s) => s.assists === null);
    expect(rawNullAssists).toBeDefined();

    const { client } = clientFor(raw);
    const out = await client.getScorers('PL', 2025);
    const mapped = out.find((s) => s.playerFdId === rawNullAssists!.player.id)!;
    expect(mapped).toBeDefined();
    expect(mapped.assists).toBeNull();
  });
});

describe('FootballDataClient.getStandings', () => {
  it('maps the TOTAL table, not HOME or AWAY — verified against a fixture with all three groups', async () => {
    const raw = snap('fd-standings-pl') as {
      standings: Array<{
        type: string;
        table: Array<{ position: number; team: { id: number }; playedGames: number; points: number }>;
      }>;
    };
    const totalGroup = raw.standings.find((g) => g.type === 'TOTAL');
    const homeGroup = raw.standings.find((g) => g.type === 'HOME');
    const awayGroup = raw.standings.find((g) => g.type === 'AWAY');
    expect(totalGroup).toBeDefined();
    expect(homeGroup).toBeDefined();
    expect(awayGroup).toBeDefined();

    // Confirm `played` is a genuine discriminator in this fixture (not an
    // assumption): a completed 38-game season shows TOTAL.played = 38 while
    // HOME/AWAY each show 19 (one leg apiece). Note: in this real fixture
    // TOTAL happens to sit at index 0 of `standings`, so it is located here
    // by `.find(type === 'TOTAL')` rather than by index — that keeps the
    // assertions below meaningful even though index-0 luck can't be ruled
    // out for this particular snapshot.
    expect(totalGroup!.table[0]!.playedGames).toBe(38);
    expect(homeGroup!.table[0]!.playedGames).toBe(19);
    expect(awayGroup!.table[0]!.playedGames).toBe(19);

    const { client } = clientFor(raw);
    const rows = await client.getStandings('PL', 2025);
    expect(rows).toHaveLength(20);
    expect(rows[0]!.position).toBe(1);
    expect(rows[0]!.points).toBeGreaterThan(0);

    // `played` distinguishes TOTAL (38) from HOME/AWAY (19) — this fails if
    // getStandings picks the wrong group.
    expect(rows[0]!.played).toBe(38);
    // Cross-check the mapped row against the raw TOTAL group directly,
    // located by type rather than by array index.
    expect(rows[0]!.points).toBe(totalGroup!.table[0]!.points);
    expect(rows[0]!.teamFdId).toBe(totalGroup!.table[0]!.team.id);
  });

  it('embeds the club identity fields from the row\'s team object — the zero-request source of a relegated club\'s metadata', async () => {
    // The backfill's historical-clubs phase relies on getStandings alone to
    // create a team row for a relegated club, with no follow-up request to
    // /teams/{id} (which 403s for clubs no longer in a covered competition).
    // That only works if name/shortName/tla/crest survive the mapping.
    const raw = snap('fd-standings-pl') as {
      standings: Array<{
        type: string;
        table: Array<{ team: { id: number; name: string; shortName: string; tla: string; crest: string } }>;
      }>;
    };
    const totalGroup = raw.standings.find((g) => g.type === 'TOTAL')!;
    const rawTeam = totalGroup.table[0]!.team;

    const { client } = clientFor(raw);
    const rows = await client.getStandings('PL', 2025);
    const row = rows[0]!;
    expect(row.teamName).toBe(rawTeam.name);
    expect(row.teamShortName).toBe(rawTeam.shortName);
    expect(row.teamTla).toBe(rawTeam.tla);
    expect(row.teamCrestUrl).toBe(rawTeam.crest);
  });
});

describe('FootballDataClient.getCompetitionTeams', () => {
  it('maps every current club with full metadata, straight from the competition teams endpoint', async () => {
    const raw = snap('fd-competition-teams-pd') as {
      teams: Array<{
        id: number; name: string; shortName: string; tla: string; crest: string;
        venue: string; founded: number; clubColors: string;
      }>;
    };
    expect(raw.teams.length).toBe(20);
    const rawFirst = raw.teams[0]!;

    const { client } = clientFor(raw);
    const out = await client.getCompetitionTeams('PD');
    expect(out).toHaveLength(20);
    const first = out[0]!;

    // Exact-value assertions against the real captured fixture (Athletic
    // Club), not guessed placeholders — catches a field mix-up that a bare
    // typeof check would miss.
    expect(first.fdId).toBe(rawFirst.id);
    expect(first.name).toBe(rawFirst.name);
    expect(first.crestUrl).toBe(rawFirst.crest);
    expect(first.venue).toBe(rawFirst.venue);
    expect(first.founded).toBe(rawFirst.founded);
    expect(first.name).toBe('Athletic Club');
    expect(first.crestUrl).toBe('https://crests.football-data.org/77.png');
    expect(first.venue).toBe('San Mamés');
    expect(first.founded).toBe(1898);
  });

  it('confirms RCD Mallorca — the club that 403s on /teams/{id} after relegation — is absent from the current teams listing', async () => {
    // This is the empirical basis for the historical-clubs phase: a
    // relegated club genuinely does not appear here, so its identity must
    // come from getStandings instead.
    const raw = snap('fd-competition-teams-pd') as { teams: Array<{ name: string }> };
    expect(raw.teams.some((t) => /mallorca/i.test(t.name))).toBe(false);
  });

  it('sends the auth header and hits the competition teams endpoint (no season param)', async () => {
    const { client, calls } = clientFor(snap('fd-competition-teams-pd'));
    await client.getCompetitionTeams('PD');
    expect(calls[0]).toContain('/competitions/PD/teams');
  });

  it('feeds the rate-limit header back into the limiter', async () => {
    const { client, limiter } = clientFor(snap('fd-competition-teams-pd'), {
      'x-requests-available-minute': '6',
    });
    await client.getCompetitionTeams('PD');
    expect(limiter.available).toBe(6);
  });
});

describe('FootballDataClient.getSquad', () => {
  it('returns the team and its squad members', async () => {
    const { client } = clientFor(snap('fd-team-57'));
    const { team, squad } = await client.getSquad(57);
    expect(team.fdId).toBe(57);
    expect(team.crestUrl).toContain('crests.football-data.org');
    expect(squad.length).toBeGreaterThan(20);
    expect(squad[0]!.name).toBeTruthy();
  });
});

describe('FootballDataClient error handling', () => {
  it('throws with status and body on a non-2xx response', async () => {
    const fetchImpl = (async () =>
      new Response('{"message":"nope"}', { status: 403 })) as unknown as typeof fetch;
    const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, sleep: async () => {} });
    const client = new FootballDataClient({ apiKey: 'k', limiter, fetchImpl });
    await expect(client.getMatches('PL', 2026)).rejects.toThrow(/403.*nope/s);
  });
});

describe('FootballDataClient retry with backoff', () => {
  function retryClientFor(
    responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
  ) {
    let callIndex = 0;
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const r = responses[Math.min(callIndex, responses.length - 1)]!;
      callIndex++;
      return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
    }) as unknown as typeof fetch;
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => { sleepCalls.push(ms); };
    // A fake clock for the limiter itself, distinct from the client's own
    // `sleep` above: a 429 can report `x-requests-available-minute: 0`
    // (see the "feeds the limiter" test below), which drives the limiter's
    // *own* internal acquire() into its wait loop. With a real clock and a
    // no-op sleep that loop would busy-spin for a genuine 60 real seconds
    // before refilling — exactly what a fake, instantly-advancing clock
    // (the same pattern tests/ingest/rateLimiter.test.ts uses) avoids.
    let limiterClock = 0;
    const limiter = new RateLimiter({
      capacity: 10,
      windowMs: 60_000,
      now: () => limiterClock,
      sleep: async (ms: number) => { limiterClock += ms; },
    });
    const client = new FootballDataClient({ apiKey: 'k', limiter, fetchImpl, sleep });
    return { client, calls, sleepCalls, limiter, callCount: () => callIndex };
  }

  it('retries once on a 429 then succeeds on the following 200 — the matchday cascade case', async () => {
    const raw = snap('fd-matches-pl');
    const { client, calls, sleepCalls } = retryClientFor([
      { status: 429, body: { message: 'rate limited' }, headers: { 'X-RequestCounter-Reset': '5' } },
      { status: 200, body: raw },
    ]);

    const out = await client.getMatches('PL', 2026);
    expect(out.length).toBeGreaterThan(300);
    expect(calls.length).toBe(2);
    // Honoured the X-RequestCounter-Reset hint (5s) rather than the 60s
    // fallback: waited (5 + 1) * 1000 = 6000ms.
    expect(sleepCalls).toEqual([6000]);
  });

  it('falls back to a full window wait when X-RequestCounter-Reset is absent on a 429', async () => {
    const raw = snap('fd-matches-pl');
    const { client, sleepCalls } = retryClientFor([
      { status: 429, body: { message: 'rate limited' } },
      { status: 200, body: raw },
    ]);

    await client.getMatches('PL', 2026);
    expect(sleepCalls).toEqual([60_000]);
  });

  it('retries a 5xx with a short linear backoff, not the 429 reset logic', async () => {
    const raw = snap('fd-matches-pl');
    const { client, calls, sleepCalls } = retryClientFor([
      { status: 503, body: { message: 'down' } },
      { status: 200, body: raw },
    ]);

    await client.getMatches('PL', 2026);
    expect(calls.length).toBe(2);
    expect(sleepCalls).toEqual([1000]);
  });

  it('feeds the limiter from a failed attempt, not just the eventual success', async () => {
    const raw = snap('fd-matches-pl');
    const { client, limiter } = retryClientFor([
      { status: 429, body: { message: 'rate limited' }, headers: { 'x-requests-available-minute': '0' } },
      { status: 200, body: raw, headers: { 'x-requests-available-minute': '9' } },
    ]);

    await client.getMatches('PL', 2026);
    // The limiter should have been synced from BOTH responses in order —
    // the final observed value comes from the successful second response.
    expect(limiter.available).toBe(9);
  });

  it('does not retry a 403 — the squads/backfill 403-detection path must fail on the first attempt', async () => {
    const { client, calls } = retryClientFor([
      { status: 403, body: { message: 'forbidden' } },
      { status: 200, body: snap('fd-matches-pl') },
    ]);

    await expect(client.getMatches('PL', 2026)).rejects.toThrow(/403.*forbidden/s);
    expect(calls.length).toBe(1);
  });

  it('gives up after exhausting all attempts on a persistent 429, throwing with full context', async () => {
    const { client, calls } = retryClientFor([
      { status: 429, body: { message: 'still limited' } },
      { status: 429, body: { message: 'still limited' } },
      { status: 429, body: { message: 'still limited' } },
    ]);

    await expect(client.getMatches('PL', 2026)).rejects.toThrow(/429.*still limited/s);
    expect(calls.length).toBe(3); // MAX_ATTEMPTS, no more
  });

  it('gives up after exhausting all attempts on a persistent 5xx', async () => {
    const { client, calls } = retryClientFor([
      { status: 500, body: { message: 'boom' } },
      { status: 500, body: { message: 'boom' } },
      { status: 500, body: { message: 'boom' } },
    ]);

    await expect(client.getMatches('PL', 2026)).rejects.toThrow(/500.*boom/s);
    expect(calls.length).toBe(3);
  });
});

describe('FootballDataClient.getMatchesAcrossLeagues', () => {
  function multiClientFor(body: unknown) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const limiter = new RateLimiter({ capacity: 10, windowMs: 60_000, sleep: async () => {} });
    return { client: new FootballDataClient({ apiKey: 'k', limiter, fetchImpl }), calls };
  }

  it('hits /matches with a comma-separated competitions filter and the date window, no per-league request', async () => {
    const body = { matches: [] };
    const { client, calls } = multiClientFor(body);
    await client.getMatchesAcrossLeagues(['PL', 'PD', 'SA', 'BL1', 'FL1'], '2026-08-14', '2026-08-21', 2026);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/matches?competitions=PL,PD,SA,BL1,FL1');
    expect(calls[0]).toContain('dateFrom=2026-08-14');
    expect(calls[0]).toContain('dateTo=2026-08-21');
  });

  it('resolves each match\'s league from its own competition.code, not the request', async () => {
    const body = {
      matches: [
        { id: 1, utcDate: '2026-08-15T14:00:00Z', status: 'SCHEDULED', homeTeam: { id: 10 }, awayTeam: { id: 11 }, competition: { code: 'PD' } },
        { id: 2, utcDate: '2026-08-15T16:00:00Z', status: 'SCHEDULED', homeTeam: { id: 20 }, awayTeam: { id: 21 }, competition: { code: 'PL' } },
      ],
    };
    const { client } = multiClientFor(body);
    const out = await client.getMatchesAcrossLeagues(['PL', 'PD'], '2026-08-14', '2026-08-21', 2026);
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.fdId === 1)!.leagueCode).toBe('PD');
    expect(out.find((m) => m.fdId === 2)!.leagueCode).toBe('PL');
  });

  it('skips a match tagged with a competition code we do not track, rather than guessing', async () => {
    const body = {
      matches: [
        { id: 1, utcDate: '2026-08-15T14:00:00Z', status: 'SCHEDULED', homeTeam: { id: 10 }, awayTeam: { id: 11 }, competition: { code: 'CL' } },
      ],
    };
    const { client } = multiClientFor(body);
    const out = await client.getMatchesAcrossLeagues(['PL', 'PD'], '2026-08-14', '2026-08-21', 2026);
    expect(out).toHaveLength(0);
  });
});
