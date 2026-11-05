// The family: the head of house, whose stats shape the business, and the heirs who will follow.
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import type { GameState, Person } from "./types";

export type Stat = "acumen" | "prudence" | "connections";
export const STATS: Stat[] = ["acumen", "prudence", "connections"];

/**
 * The starting family from data/family.json: the head with fixed stats, then each child with stats
 * drawn from child_stats. Three rolls per child, in data order.
 */
export function createFamily(data: GameData, rng: Rng): Person[] {
  const { min, max } = data.tuning.family.child_stats;
  const draw = () => min + Math.floor(rng.next() * (max - min + 1));
  const { head, children } = data.family;
  return [
    { id: 1, house_id: 1, name: head.name, birth_year: head.birth_year, death_year: null, is_head: true, acumen: head.acumen, prudence: head.prudence, connections: head.connections },
    ...children.map((c, i): Person => ({
      id: i + 2, house_id: 1, name: c.name, birth_year: c.birth_year, death_year: null, is_head: false, acumen: draw(), prudence: draw(), connections: draw(),
    })),
  ];
}

/** Age in whole years during `year` (birthdays fall at the start of the year). */
export function ageIn(p: Pick<Person, "birth_year">, year: number): number {
  return year - p.birth_year;
}

/** The living head of house, or undefined if there is none (only between a death and its succession). */
export function headOf(state: GameState): Person | undefined {
  return state.people.find((p) => p.is_head && p.death_year === null);
}

/** Living family members who are not the head, oldest first. */
export function heirsOf(state: GameState): Person[] {
  return state.people.filter((p) => !p.is_head && p.death_year === null).sort((a, b) => a.birth_year - b.birth_year || a.id - b.id);
}

/** The head's stat as it acts on the business. A house with no head acts at the neutral value. */
export function headStat(state: GameState, stat: Stat, tuning: Tuning): number {
  const head = headOf(state);
  return head ? head[stat] : tuning.family.neutral_stat;
}

/** Multiplier on venture failure risk from the head's Acumen: 1 at neutral, lower above it, higher below. */
export function acumenFactor(acumen: number, tuning: Tuning): number {
  const f = tuning.family;
  return Math.max(0, 1 - f.acumen_step * (acumen - f.neutral_stat));
}

/** Points taken off every state's reputation gate by the head's Connections (negative below neutral). */
export function connectionsBonus(connections: number, tuning: Tuning): number {
  const f = tuning.family;
  return f.connections_step * (connections - f.neutral_stat);
}
