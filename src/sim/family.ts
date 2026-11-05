// The family: the head of house, whose stats shape the business, and the heirs who will follow.
import { cloneState } from "./state";
import { checkActionLeft, type DecisionResult } from "./actions";
import { fl } from "./format";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import type { GameState, InvestFamilyDecision, Person } from "./types";

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
    { id: 1, house_id: 1, name: head.name, birth_year: head.birth_year, death_year: null, is_head: true, acumen: head.acumen, prudence: head.prudence, connections: head.connections, inexperienced_until: null },
    ...children.map((c, i): Person => ({
      id: i + 2, house_id: 1, name: c.name, birth_year: c.birth_year, death_year: null, is_head: false, acumen: draw(), prudence: draw(), connections: draw(), inexperienced_until: null,
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

/**
 * The head's stat as it acts on the business: lower by inexperience_penalty (never below 1) while
 * an untrained head is inexperienced. A house with no head acts at the neutral value.
 */
export function headStat(state: GameState, stat: Stat, tuning: Tuning): number {
  const head = headOf(state);
  if (!head) return tuning.family.neutral_stat;
  const green = head.inexperienced_until !== null && state.world.turn < head.inexperienced_until;
  return green ? Math.max(1, head[stat] - tuning.family.succession.inexperience_penalty) : head[stat];
}

/** Sum of a person's three stats. */
export const statTotal = (p: Pick<Person, Stat>) => p.acumen + p.prudence + p.connections;

/** Trained heirs are adults whose stats reach trained_total. */
export function isTrained(p: Person, year: number, tuning: Tuning): boolean {
  const s = tuning.family.succession;
  return ageIn(p, year) >= s.adult_age && statTotal(p) >= s.trained_total;
}

/** The head's yearly chance of death at `age`: 0 before from_age, then base + per_year per year past it, up to 1. */
export function yearlyDeathChance(age: number, tuning: Tuning): number {
  const d = tuning.family.death;
  return age < d.from_age ? 0 : Math.min(1, d.base + d.per_year * (age - d.from_age));
}

/** The same chance per quarter: 1 - (1 - yearly)^(1/4). */
export function quarterlyDeathChance(age: number, tuning: Tuning): number {
  return 1 - Math.pow(1 - yearlyDeathChance(age, tuning), 0.25);
}

/**
 * The heir who would take over now: the best trained (highest stat total, then the eldest), or if
 * none is trained the best of the rest by the same order. Undefined if there are no heirs.
 */
export function successor(state: GameState, tuning: Tuning): Person | undefined {
  const { year } = state.world;
  const rank = (p: Person) => (isTrained(p, year, tuning) ? 1 : 0);
  return [...heirsOf(state)].sort(
    (a, b) => rank(b) - rank(a) || statTotal(b) - statTotal(a) || a.birth_year - b.birth_year || a.id - b.id,
  )[0];
}

/**
 * The head dies this quarter and the successor takes over at once. A trained heir costs a little
 * reputation; an untrained one (a child, or poorly taught) costs more and is inexperienced for a
 * while. With no heir left, a distant cousin takes over, untrained. Mutates `state`.
 */
export function succeed(state: GameState, data: GameData): void {
  const t = data.tuning.family.succession;
  const { year, turn } = state.world;
  const dead = headOf(state);
  if (!dead) return;
  dead.death_year = year;
  dead.is_head = false;
  let next = successor(state, data.tuning);
  if (!next) {
    const c = data.family.cousin;
    next = {
      id: state.people.length + 1, house_id: 1, name: c.name, birth_year: year - c.age, death_year: null, is_head: false,
      acumen: t.cousin_stat, prudence: t.cousin_stat, connections: t.cousin_stat, inexperienced_until: null,
    };
    state.people.push(next);
  }
  const trained = isTrained(next, year, data.tuning);
  next.is_head = true;
  if (!trained) next.inexperienced_until = turn + t.inexperience_quarters;
  const loss = trained ? t.reputation_trained : t.reputation_untrained;
  state.house.reputation = Math.max(0, state.house.reputation - loss);
  state.successions.push({ turn, from: dead.id, to: next.id, trained });
}

/**
 * The family's quarter: one roll for the head's death once they reach death.from_age (succession
 * follows at once), then at year end one roll for a birth if the head is of age and has room for
 * heirs. Mutates `state`; callers pass a draft copy.
 */
export function resolveFamily(state: GameState, rng: Rng, data: GameData): void {
  const { year, quarter } = state.world;
  const head = headOf(state);
  if (head) {
    const p = quarterlyDeathChance(ageIn(head, year), data.tuning);
    if (p > 0 && rng.next() < p) succeed(state, data);
  }
  if (quarter !== 4) return;
  const b = data.tuning.family.births;
  const parent = headOf(state);
  if (!parent || heirsOf(state).length >= b.max_heirs) return;
  const age = ageIn(parent, year);
  if (age < b.min_head_age || age > b.max_head_age) return;
  if (rng.next() >= b.chance) return;
  // The first name on the list that no one in the family has yet.
  const surname = data.family.surname;
  const first = data.family.child_names.find((n) => !state.people.some((p) => p.name === `${n} ${surname}`)) ?? "Child";
  const { min, max } = data.tuning.family.child_stats;
  const draw = () => min + Math.floor(rng.next() * (max - min + 1));
  state.people.push({
    id: state.people.length + 1, house_id: 1, name: `${first} ${surname}`, birth_year: year + 1, death_year: null, is_head: false,
    acumen: draw(), prudence: draw(), connections: draw(), inexperienced_until: null,
  });
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

/** What a form of family investment costs, in whole gulden. */
export function investCost(form: InvestFamilyDecision["form"], tuning: Tuning): number {
  return tuning.family.invest[form].cost;
}

/** Returns why an invest_family decision is invalid, or null if it can go ahead. */
export function checkInvestFamily(state: GameState, d: InvestFamilyDecision, tuning: Tuning): string | null {
  const noAction = checkActionLeft(state, tuning);
  if (noAction) return noAction;
  const max = tuning.family.max_stat;
  if (d.form === "educate") {
    if (!STATS.includes(d.stat)) return `Unknown stat "${d.stat}"`;
    const heir = heirsOf(state).find((p) => p.id === d.heir);
    if (!heir) return `No living heir #${d.heir}`;
    if (heir[d.stat] >= max) return `${heir.name}'s ${d.stat} is already ${max}`;
  } else if (d.form === "patronage") {
    const head = headOf(state);
    if (head && head.connections >= max) return `${head.name}'s connections are already ${max}`;
  } else if (d.form !== "charity") return `Unknown form of investment "${(d as { form: string }).form}"`;
  const cost = investCost(d.form, tuning);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Invests in the family. Returns a new state; the input is not changed. */
export function investFamily(state: GameState, d: InvestFamilyDecision, data: GameData): DecisionResult {
  const t = data.tuning;
  const reason = checkInvestFamily(state, d, t);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const inv = t.family.invest;
  const cost = investCost(d.form, t);
  const raise = (n: number) => (next.house.reputation = Math.min(100, next.house.reputation + n));
  let note: string;
  if (d.form === "educate") {
    const heir = next.people.find((p) => p.id === d.heir)!;
    heir[d.stat] = Math.min(t.family.max_stat, heir[d.stat] + inv.educate.gain);
    note = `Tutors for ${heir.name} (${d.stat})`;
  } else if (d.form === "charity") {
    raise(inv.charity.reputation);
    note = "Gift to the poor of Frankfurt";
  } else {
    const head = headOf(next);
    if (head) head.connections = Math.min(t.family.max_stat, head.connections + inv.patronage.connections);
    raise(inv.patronage.reputation);
    note = "Patronage of the arts";
  }
  next.house.cash -= cost;
  next.actions_this_turn += 1;
  addEntry(next, "cash", "family", -cost, note);
  return { ok: true, state: next };
}

/** heir_talent: one living heir, picked at random, gains in one random stat. Two rolls, none if no heir. Mutates `state`. */
export function heirTalent(state: GameState, gain: number, rng: Rng, tuning: Tuning): void {
  const heirs = heirsOf(state);
  if (!heirs.length) return;
  const heir = heirs[Math.floor(rng.next() * heirs.length)]!;
  const stat = STATS[Math.floor(rng.next() * STATS.length)]!;
  heir[stat] = Math.min(tuning.family.max_stat, heir[stat] + gain);
}
