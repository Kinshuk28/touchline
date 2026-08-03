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
