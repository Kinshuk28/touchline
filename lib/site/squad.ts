import type { SquadPlayer } from '@/lib/site/queries/players';

/**
 * `players.position` is free text arriving from two providers that do not
 * agree: football-data.org writes "Centre-Back", "Defensive Midfield",
 * "Goalkeeper"; the FPL feed writes "GKP", "DEF", "MID", "FWD". A squad
 * list that shows those side by side looks broken, and one that invents a
 * tidy position for every player would be inventing data.
 *
 * So this maps only what both vocabularies state unambiguously, into the
 * four buckets every reader already knows, and puts anything it cannot
 * place — including `null`, which is common — into an honest "Position not
 * recorded" group rather than guessing at it.
 */
export type SquadGroup = 'Goalkeepers' | 'Defenders' | 'Midfielders' | 'Forwards' | 'Position not recorded';

export const SQUAD_GROUP_ORDER: readonly SquadGroup[] = [
  'Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Position not recorded',
];

/**
 * Maps one stored `position` string to a group. Matching is on whole
 * lower-cased words, not substrings — "Defensive Midfield" must land in
 * Midfielders, and a substring test for "def" would file it under
 * Defenders, which is the same class of bug the news matcher exists to
 * avoid (lib/site/newsRelevance.ts).
 */
export function squadGroupOf(position: string | null | undefined): SquadGroup {
  if (!position) return 'Position not recorded';
  const words = position.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const has = (w: string) => words.includes(w);

  if (has('goalkeeper') || has('gkp') || has('gk')) return 'Goalkeepers';
  // Checked before Defenders so "Defensive Midfield" resolves on the
  // midfield word rather than the defensive one.
  if (has('midfield') || has('midfielder') || has('mid')) return 'Midfielders';
  if (has('back') || has('defender') || has('defence') || has('def')) return 'Defenders';
  if (has('forward') || has('striker') || has('winger') || has('attacker') || has('offence') || has('fwd')) {
    return 'Forwards';
  }
  return 'Position not recorded';
}

export interface GroupedSquad {
  group: SquadGroup;
  players: SquadPlayer[];
}

/**
 * Groups a squad for display, in football's conventional order, dropping
 * any group with nobody in it. Input order is preserved inside each group
 * (`getSquad` returns players alphabetically), so the page never needs a
 * second sort.
 */
export function groupSquadByPosition(players: readonly SquadPlayer[]): GroupedSquad[] {
  const byGroup = new Map<SquadGroup, SquadPlayer[]>();
  for (const player of players) {
    const group = squadGroupOf(player.position);
    byGroup.set(group, [...(byGroup.get(group) ?? []), player]);
  }
  return SQUAD_GROUP_ORDER
    .map((group) => ({ group, players: byGroup.get(group) ?? [] }))
    .filter((g) => g.players.length > 0);
}
