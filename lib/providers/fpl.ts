const BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const EVENT_LIVE = (event: number) => `https://fantasy.premierleague.com/api/event/${event}/live/`;

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

/**
 * The same four positions as codes, which is the form the fantasy game
 * reasons in (`lib/fantasy/squadRules.ts`). FPL's `element_type` is the
 * authoritative classification for fantasy purposes -- football-data's
 * position text is finer-grained ("Defensive Midfield") and disagrees with
 * FPL often enough that using it to decide a squad's legal shape would
 * reject squads FPL itself would accept.
 */
const POSITION_CODES: Record<number, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD',
};

export interface FplPlayer {
  fplId: number;
  name: string;
  webName: string;
  teamFplId: number;
  position: string | null;
  /** FPL's own GK/DEF/MID/FWD, the classification the fantasy game's shape rules use. */
  positionCode: 'GK' | 'DEF' | 'MID' | 'FWD' | null;
  /** `now_cost` — tenths of a million, so 125 is £12.5m. The game's only source of scarcity. */
  nowCost: number | null;
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

/**
 * One gameweek, as the season calendar describes it.
 *
 * `dataChecked` is the field that matters most to ingest: FPL sets it once a
 * gameweek is settled — bonus points applied, corrections made — and until
 * then every score in that week is provisional. `finished` comes earlier,
 * when the last match ends, and is not the same thing.
 */
export interface FplEvent {
  id: number;
  name: string;
  deadlineTime: string | null;
  finished: boolean;
  dataChecked: boolean;
  isCurrent: boolean;
  isNext: boolean;
}

export interface FplBootstrap {
  players: FplPlayer[];
  teams: FplTeam[];
  /** The season's 38 gameweeks, in order. Empty if FPL sent none. */
  events: FplEvent[];
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
    const data = (await res.json()) as {
      elements?: FplElement[];
      teams?: FplTeamRaw[];
      events?: FplEventRaw[];
    };

    const players = (data.elements ?? [])
      // Never store a manager (or any other future non-playing element_type)
      // as a player at all — see the KNOWN_POSITION_TYPES comment above.
      .filter((e) => KNOWN_POSITION_TYPES.has(e.element_type))
      .map(mapPlayer);
    const teams = (data.teams ?? []).map((t) => ({ fplId: t.id, name: t.name, shortName: t.short_name }));
    const events = (data.events ?? []).map(mapEvent);

    return { players, teams, events };
  }

  async getPlayers(): Promise<FplPlayer[]> {
    return (await this.getBootstrap()).players;
  }

  /**
   * One gameweek's stat line for every player, from `event/{id}/live`.
   *
   * This is the endpoint Phase C's fantasy scoring rests on, and the reason
   * the game is Premier League only: nothing equivalent exists for the other
   * four competitions on any free tier, and season totals cannot be
   * differenced into weekly points (an ingest gap becomes a zero-point week,
   * an upstream correction a negative one — see the Phase C spec).
   *
   * `totalPoints` is FPL's own figure, stored as published rather than
   * recomputed here. Their scoring rules change between seasons — defensive
   * contribution points arrived in 2025-26 — and a reimplementation would be
   * a second source of truth that silently drifts from the first. The
   * component stats come along so a score can be *explained* ("2 goals, a
   * clean sheet, 3 bonus"), never so it can be re-derived.
   *
   * One request per gameweek, unmetered, and only ever called for a
   * gameweek that has started.
   */
  async getGameweekLive(event: number): Promise<FplLiveLine[]> {
    if (!Number.isInteger(event) || event < 1) {
      throw new Error(`FPL getGameweekLive: gameweek must be a positive integer, got ${event}`);
    }
    const res = await this.fetchImpl(EVENT_LIVE(event));
    if (!res.ok) throw new Error(`FPL API ${res.status} for event/${event}/live`);
    const data = (await res.json()) as { elements?: FplLiveElement[] };
    return (data.elements ?? []).map((e) => mapLiveLine(e, event));
  }
}

/**
 * One player's gameweek. Every field is what FPL published; `null` means the
 * payload didn't carry it, never a substituted zero — the same rule
 * `mapPlayer` follows above and for the same reason.
 */
export interface FplLiveLine {
  fplId: number;
  gameweek: number;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  cleanSheets: number | null;
  goalsConceded: number | null;
  ownGoals: number | null;
  penaltiesSaved: number | null;
  penaltiesMissed: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  bonus: number | null;
  /** FPL's own total for the gameweek. Stored as published, never recomputed. */
  totalPoints: number | null;
}

function mapLiveLine(e: FplLiveElement, event: number): FplLiveLine {
  const s = e.stats ?? {};
  return {
    fplId: e.id,
    gameweek: event,
    minutes: s.minutes ?? null,
    goals: s.goals_scored ?? null,
    assists: s.assists ?? null,
    cleanSheets: s.clean_sheets ?? null,
    goalsConceded: s.goals_conceded ?? null,
    ownGoals: s.own_goals ?? null,
    penaltiesSaved: s.penalties_saved ?? null,
    penaltiesMissed: s.penalties_missed ?? null,
    yellowCards: s.yellow_cards ?? null,
    redCards: s.red_cards ?? null,
    saves: s.saves ?? null,
    bonus: s.bonus ?? null,
    totalPoints: s.total_points ?? null,
  };
}

interface FplLiveElement {
  id: number;
  stats?: {
    minutes?: number;
    goals_scored?: number;
    assists?: number;
    clean_sheets?: number;
    goals_conceded?: number;
    own_goals?: number;
    penalties_saved?: number;
    penalties_missed?: number;
    yellow_cards?: number;
    red_cards?: number;
    saves?: number;
    bonus?: number;
    total_points?: number;
  };
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
    positionCode: POSITION_CODES[e.element_type] ?? null,
    // `?? null` for the same reason as the stats below: a missing price is
    // unknown, and a player priced at £0.0m would be free to pick.
    nowCost: e.now_cost ?? null,
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
  now_cost?: number;
  photo?: string;
}

interface FplTeamRaw {
  id: number;
  name: string;
  short_name: string;
}

function mapEvent(e: FplEventRaw): FplEvent {
  return {
    id: e.id,
    name: e.name ?? `Gameweek ${e.id}`,
    deadlineTime: e.deadline_time ?? null,
    // These four are booleans upstream and genuinely default to false: an
    // absent `data_checked` means "not settled", which is the safe reading
    // in both directions — it makes ingest re-fetch a week rather than
    // freeze a provisional score as final.
    finished: e.finished === true,
    dataChecked: e.data_checked === true,
    isCurrent: e.is_current === true,
    isNext: e.is_next === true,
  };
}

interface FplEventRaw {
  id: number;
  name?: string;
  deadline_time?: string | null;
  finished?: boolean;
  data_checked?: boolean;
  is_current?: boolean;
  is_next?: boolean;
}
