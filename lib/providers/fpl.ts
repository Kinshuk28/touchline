const BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const POSITIONS: Record<number, string> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
};

// `bootstrap-static`'s `elements` array is not exclusively players: FPL adds a
// fifth `element_type` (5) for **managers** once a season introduces fantasy
// manager scoring, and any other value FPL introduces in future is equally
// not a playing position. Filtering on this set (rather than defaulting an
// unrecognised `element_type` to a guessed position) is what keeps a manager
// row from being stored as a player with a fabricated `'Unknown'` position —
// see `getBootstrap` below.
const KNOWN_POSITION_TYPES = new Set(Object.keys(POSITIONS).map(Number));

export interface FplPlayer {
  fplId: number;
  name: string;
  webName: string;
  teamFplId: number;
  position: string | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  expectedGoals: number | null;
  photoUrl: string | null;
}

export interface FplTeam {
  fplId: number;
  name: string;
  shortName: string;
}

export interface FplBootstrap {
  players: FplPlayer[];
  teams: FplTeam[];
}

export class FplClient {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Single bulk fetch of `bootstrap-static`, returning both players and the
   * 20 Premier League clubs it embeds. One request serves both — a second
   * `getTeams()` method that re-fetched the same endpoint would double the
   * (unmetered, but still real) network cost for no benefit.
   */
  async getBootstrap(): Promise<FplBootstrap> {
    const res = await this.fetchImpl(BOOTSTRAP);
    if (!res.ok) throw new Error(`FPL API ${res.status} for bootstrap-static`);
    const data = (await res.json()) as { elements?: FplElement[]; teams?: FplTeamRaw[] };

    const players = (data.elements ?? [])
      // Never store a manager (or any other future non-playing element_type)
      // as a player at all — see the KNOWN_POSITION_TYPES comment above.
      .filter((e) => KNOWN_POSITION_TYPES.has(e.element_type))
      .map(mapPlayer);
    const teams = (data.teams ?? []).map((t) => ({ fplId: t.id, name: t.name, shortName: t.short_name }));

    return { players, teams };
  }

  async getPlayers(): Promise<FplPlayer[]> {
    return (await this.getBootstrap()).players;
  }
}

function mapPlayer(e: FplElement): FplPlayer {
  const xg = e.expected_goals === undefined ? null : Number.parseFloat(String(e.expected_goals));
  return {
    fplId: e.id,
    name: `${e.first_name} ${e.second_name}`.trim(),
    webName: e.web_name,
    teamFplId: e.team,
    // Defensive fallback only — every element reaching this point already
    // passed the KNOWN_POSITION_TYPES filter in getBootstrap, so this branch
    // should be unreachable, but a guessed position is never an acceptable
    // substitute for `null` if it somehow is.
    position: POSITIONS[e.element_type] ?? null,
    // `?? 0` here would turn "this field is absent from the payload" into an
    // authoritative "this player has played 0 minutes / scored 0 goals" —
    // exactly the fabrication this product promises never to do. `null`
    // means "unknown"; a real `0` (see the mapping below) still survives as
    // `0`, only `undefined`/missing becomes `null`.
    minutes: e.minutes ?? null,
    goals: e.goals_scored ?? null,
    assists: e.assists ?? null,
    expectedGoals: xg === null || Number.isNaN(xg) ? null : xg,
    photoUrl: e.photo
      ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${e.photo.replace(/\.jpg$/, '')}.png`
      : null,
  };
}

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
  element_type: number;
  minutes?: number;
  goals_scored?: number;
  assists?: number;
  expected_goals?: string | number;
  photo?: string;
}

interface FplTeamRaw {
  id: number;
  name: string;
  short_name: string;
}
