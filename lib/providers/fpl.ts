const BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const POSITIONS: Record<number, string> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
};

export interface FplPlayer {
  fplId: number;
  name: string;
  webName: string;
  teamFplId: number;
  position: string;
  minutes: number;
  goals: number;
  assists: number;
  expectedGoals: number | null;
  photoUrl: string | null;
}

export class FplClient {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getPlayers(): Promise<FplPlayer[]> {
    const res = await this.fetchImpl(BOOTSTRAP);
    if (!res.ok) throw new Error(`FPL API ${res.status} for bootstrap-static`);
    const data = (await res.json()) as { elements?: FplElement[] };
    return (data.elements ?? []).map(mapPlayer);
  }
}

function mapPlayer(e: FplElement): FplPlayer {
  const xg = e.expected_goals === undefined ? null : Number.parseFloat(String(e.expected_goals));
  return {
    fplId: e.id,
    name: `${e.first_name} ${e.second_name}`.trim(),
    webName: e.web_name,
    teamFplId: e.team,
    position: POSITIONS[e.element_type] ?? 'Unknown',
    minutes: e.minutes ?? 0,
    goals: e.goals_scored ?? 0,
    assists: e.assists ?? 0,
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
