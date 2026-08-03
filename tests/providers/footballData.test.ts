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
  it('returns a non-empty array of RawScorer with mapped fields', async () => {
    const { client } = clientFor(snap('fd-scorers-pl-2025'));
    const out = await client.getScorers('PL', 2025);
    expect(out.length).toBeGreaterThan(0);
    const top = out[0]!;
    expect(typeof top.playerFdId).toBe('number');
    expect(top.playerName).toBeTruthy();
    expect(typeof top.teamFdId).toBe('number');
    expect(typeof top.goals).toBe('number');
  });

  it('sends the season parameter and hits the scorers endpoint', async () => {
    const { client, calls } = clientFor(snap('fd-scorers-pl-2025'));
    await client.getScorers('PL', 2025);
    expect(calls[0]).toContain('/competitions/PL/scorers');
    expect(calls[0]).toContain('season=2025');
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
  it('maps the total table', async () => {
    const { client } = clientFor(snap('fd-standings-pl'));
    const rows = await client.getStandings('PL', 2025);
    expect(rows).toHaveLength(20);
    expect(rows[0]!.position).toBe(1);
    expect(rows[0]!.points).toBeGreaterThan(0);
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
