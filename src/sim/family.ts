// The family: the head of house, whose stats shape the business, and the heirs who will follow.
import { cloneState } from "./state";
import { checkActionLeft, type DecisionResult } from "./actions";
import { fl } from "./format";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import { birthTrait, comingOfAgeTrait, drawTrait, openTraits, traitEffects } from "./traits";
import type { DesignateHeirDecision, GameState, InvestFamilyDecision, Person } from "./types";

export type Stat = "acumen" | "prudence" | "connections";
export const STATS: Stat[] = ["acumen", "prudence", "connections"];

/**
 * The starting family from data/family.json: the head with fixed stats and traits, then each child
 * with stats drawn from child_stats and one random trait (four rolls per child, in data order),
 * then the head's wife, fixed, who is the children's mother.
 */
export function createFamily(data: GameData, rng: Rng): Person[] {
  const { min, max } = data.tuning.family.child_stats;
  const draw = () => min + Math.floor(rng.next() * (max - min + 1));
  const { head, head_spouse: wife, children } = data.family;
  const wifeId = children.length + 2;
  const founder: Person = {
    ...person(1, head.name, head.gender, head.birth_year, "line"),
    is_head: true, acumen: head.acumen, prudence: head.prudence, connections: head.connections, traits: [...head.traits], spouse: wifeId,
  };
  const kids = children.map((c, i): Person => {
    const stats = { acumen: draw(), prudence: draw(), connections: draw() };
    const trait = drawTrait([], rng, data);
    return { ...person(i + 2, c.name, c.gender, c.birth_year, "line"), ...stats, traits: trait ? [trait] : [], parents: [1, wifeId] };
  });
  const mother: Person = {
    ...person(wifeId, wife.name, wife.gender, wife.birth_year, "spouse"),
    acumen: wife.acumen, prudence: wife.prudence, connections: wife.connections, traits: [...wife.traits], spouse: 1, origin: "merchant", born: wife.born,
  };
  return [founder, ...kids, mother];
}

/** A new person with neutral defaults: stats of 1, no traits, unmarried, no parents on record. */
export function person(id: number, name: string, gender: Person["gender"], birth_year: number, role: Person["role"]): Person {
  return {
    id, house_id: 1, name, gender, role, spouse: null, parents: [], origin: null, born: null,
    birth_year, death_year: null, is_head: false, acumen: 1, prudence: 1, connections: 1, traits: [], inexperienced_until: null,
  };
}

/** A person's husband or wife, if living. */
export function livingSpouse(state: GameState, p: Person): Person | undefined {
  const s = p.spouse === null ? undefined : state.people.find((x) => x.id === p.spouse);
  return s && s.death_year === null ? s : undefined;
}

/** Living members of the line (head or heir) with a living spouse, paired, in family order. */
export function couples(state: GameState): { member: Person; spouse: Person }[] {
  return state.people
    .filter((p) => p.role === "line" && p.death_year === null)
    .flatMap((member) => {
      const spouse = livingSpouse(state, member);
      return spouse ? [{ member, spouse }] : [];
    });
}

/** Age in whole years during `year` (birthdays fall at the start of the year). */
export function ageIn(p: Pick<Person, "birth_year">, year: number): number {
  return year - p.birth_year;
}

/** The living head of house, or undefined if there is none (only between a death and its succession). */
export function headOf(state: GameState): Person | undefined {
  return state.people.find((p) => p.is_head && p.death_year === null);
}

/** Living members of the line who are not the head, oldest first. Spouses and those who married out are not heirs. */
export function heirsOf(state: GameState): Person[] {
  return state.people.filter((p) => p.role === "line" && !p.is_head && p.death_year === null).sort((a, b) => a.birth_year - b.birth_year || a.id - b.id);
}

/** A person's stat with their traits applied, kept within 1 and max_stat. */
export function effectiveStat(p: Person, stat: Stat, data: GameData): number {
  return Math.min(data.tuning.family.max_stat, Math.max(1, p[stat] + traitEffects(p, data)[stat]));
}

/**
 * The head's stat as it acts on the business: with traits applied, and lower by
 * inexperience_penalty (never below 1) while an untrained head is inexperienced. A house with no
 * head acts at the neutral value.
 */
export function headStat(state: GameState, stat: Stat, data: GameData): number {
  const head = headOf(state);
  if (!head) return data.tuning.family.neutral_stat;
  const value = effectiveStat(head, stat, data);
  const green = head.inexperienced_until !== null && state.world.turn < head.inexperienced_until;
  return green ? Math.max(1, value - data.tuning.family.succession.inexperience_penalty) : value;
}

/** The head's traits, combined; neutral when the house has no head. */
export function headEffects(state: GameState, data: GameData): ReturnType<typeof traitEffects> {
  return traitEffects(headOf(state) ?? { traits: [] }, data);
}

/** Sum of a person's three stats as they stand, before traits. */
export const statTotal = (p: Pick<Person, Stat>) => p.acumen + p.prudence + p.connections;

/** Sum of a person's three stats with their traits applied. */
export const effectiveTotal = (p: Person, data: GameData) => STATS.reduce((sum, k) => sum + effectiveStat(p, k, data), 0);

/** Trained heirs are adults whose stats, traits included, reach trained_total. */
export function isTrained(p: Person, year: number, data: GameData): boolean {
  const s = data.tuning.family.succession;
  return ageIn(p, year) >= s.adult_age && effectiveTotal(p, data) >= s.trained_total;
}

/** The head's yearly chance of death at `age`: 0 before from_age, then base + per_year per year past it, up to 1. */
export function yearlyDeathChance(age: number, tuning: Tuning): number {
  const d = tuning.family.death;
  return age < d.from_age ? 0 : Math.min(1, d.base + d.per_year * (age - d.from_age));
}

/** The same chance per quarter, after the person's traits scale the yearly chance: 1 - (1 - yearly)^(1/4). */
export function quarterlyDeathChance(age: number, tuning: Tuning, traitFactor: number): number {
  return 1 - Math.pow(1 - Math.min(1, yearlyDeathChance(age, tuning) * traitFactor), 0.25);
}

/**
 * The heir who would take over now: the best trained (highest stat total with traits, then the
 * eldest), or if none is trained the best of the rest by the same order. Undefined if there are no heirs.
 */
export function successor(state: GameState, data: GameData): Person | undefined {
  const { year } = state.world;
  const rank = (p: Person) => (isTrained(p, year, data) ? 1 : 0);
  return [...heirsOf(state)].sort(
    (a, b) => rank(b) - rank(a) || effectiveTotal(b, data) - effectiveTotal(a, data) || a.birth_year - b.birth_year || a.id - b.id,
  )[0];
}

/**
 * The head dies this quarter and the successor takes over at once: the heir the head named, if
 * still living, else the automatic choice. A trained heir costs a little reputation; an untrained
 * one (a child, or poorly taught) costs more and is inexperienced for a while; passing over the
 * eldest living heir costs more again. With no heir left, a distant cousin takes over, untrained.
 * Mutates `state`.
 */
export function succeed(state: GameState, data: GameData): void {
  const t = data.tuning.family.succession;
  const { year, turn } = state.world;
  const dead = headOf(state);
  if (!dead) return;
  dead.death_year = year;
  dead.is_head = false;
  const eldest = heirsOf(state)[0];
  // The heir the head named, if still living; otherwise the automatic choice.
  const named = heirsOf(state).find((p) => p.id === state.house.designated_heir);
  let next = named ?? successor(state, data);
  state.house.designated_heir = null;
  if (!next) {
    const c = data.family.cousin;
    next = {
      ...person(state.people.length + 1, c.name, c.gender, year - c.age, "line"),
      acumen: t.cousin_stat, prudence: t.cousin_stat, connections: t.cousin_stat, traits: [...c.traits],
    };
    state.people.push(next);
  }
  const trained = isTrained(next, year, data);
  next.is_head = true;
  if (!trained) next.inexperienced_until = turn + t.inexperience_quarters;
  const passedOver = eldest && eldest.id !== next.id ? eldest.id : null;
  const loss = (trained ? t.reputation_trained : t.reputation_untrained) + (passedOver !== null ? t.passed_over_reputation : 0);
  state.house.reputation = Math.max(0, state.house.reputation - loss);
  state.successions.push({ turn, from: dead.id, to: next.id, trained, named: named !== undefined, passed_over: passedOver });
}

/**
 * The family's quarter: one roll for the head's death once they reach death.from_age (succession
 * follows at once), then one for each living spouse of the line who has reached it. At year end,
 * heirs who turn adult next year come of age and gain a trait (a roll only when schooling earned no
 * virtue), then each married couple in the line whose wife is of age rolls for a child while there
 * is room for heirs (a birth then draws a gender roll, three stat rolls and two trait rolls).
 * Mutates `state`; callers pass a draft copy.
 */
export function resolveFamily(state: GameState, rng: Rng, data: GameData): void {
  const { year, quarter } = state.world;
  const head = headOf(state);
  if (head) {
    const p = quarterlyDeathChance(ageIn(head, year), data.tuning, traitEffects(head, data).death_chance);
    if (p > 0 && rng.next() < p) succeed(state, data);
  }
  for (const sp of state.people.filter((x) => x.role === "spouse" && x.death_year === null)) {
    const p = quarterlyDeathChance(ageIn(sp, year), data.tuning, traitEffects(sp, data).death_chance);
    if (p > 0 && rng.next() < p) sp.death_year = year;
  }
  if (quarter !== 4) return;
  for (const heir of heirsOf(state)) {
    if (ageIn(heir, year + 1) !== data.tuning.family.succession.adult_age) continue;
    const trait = comingOfAgeTrait(heir, rng, data);
    if (trait) heir.traits.push(trait);
  }
  const b = data.tuning.family.births;
  for (const { member, spouse } of couples(state)) {
    if (heirsOf(state).length >= b.max_heirs) return;
    const wife = member.gender === "f" ? member : spouse;
    const age = ageIn(wife, year);
    if (age < b.min_mother_age || age > b.max_mother_age) continue;
    if (rng.next() >= b.chance) continue;
    birth(state, member, spouse, rng, data);
  }
}

/** A child born to a couple of the line, next year, carrying the house's surname. */
function birth(state: GameState, member: Person, spouse: Person, rng: Rng, data: GameData): void {
  const gender: Person["gender"] = rng.next() < 0.5 ? "m" : "f";
  // The first name on the list that no one in the family has yet.
  const surname = data.family.surname;
  const first = data.family.child_names[gender].find((n) => !state.people.some((p) => p.name === `${n} ${surname}`)) ?? (gender === "m" ? "Sohn" : "Tochter");
  const { min, max } = data.tuning.family.child_stats;
  const draw = () => min + Math.floor(rng.next() * (max - min + 1));
  const stats = { acumen: draw(), prudence: draw(), connections: draw() };
  const trait = birthTrait([...member.traits, ...spouse.traits], rng, data);
  state.people.push({
    ...person(state.people.length + 1, `${first} ${surname}`, gender, state.world.year + 1, "line"),
    ...stats, traits: trait ? [trait] : [], parents: [member.id, spouse.id],
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

/** What a form of family investment costs, in whole gulden: its price, scaled by the head's traits. */
export function investCost(form: InvestFamilyDecision["form"], state: GameState, data: GameData): number {
  return Math.round(data.tuning.family.invest[form].cost * headEffects(state, data).family_cost);
}

/** A reputation gain as the head's traits make it: scaled by reputation_gain, to whole points. */
export function reputationGain(points: number, state: GameState, data: GameData): number {
  return Math.round(points * headEffects(state, data).reputation_gain);
}

/** Returns why an invest_family decision is invalid, or null if it can go ahead. */
export function checkInvestFamily(state: GameState, d: InvestFamilyDecision, data: GameData): string | null {
  const tuning = data.tuning;
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
  const cost = investCost(d.form, state, data);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Invests in the family. Returns a new state; the input is not changed. */
export function investFamily(state: GameState, d: InvestFamilyDecision, data: GameData): DecisionResult {
  const t = data.tuning;
  const reason = checkInvestFamily(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const inv = t.family.invest;
  const cost = investCost(d.form, state, data);
  const raise = (n: number) => (next.house.reputation = Math.min(100, next.house.reputation + reputationGain(n, state, data)));
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

/** One living heir who could still gain `trait` (picked at random, one roll) gains it. Nothing if none can. */
export function heirTrait(state: GameState, trait: string, rng: Rng, data: GameData): void {
  const open = heirsOf(state).filter((p) => openTraits(p.traits, data).some((t) => t.id === trait));
  if (!open.length) return;
  open[Math.floor(rng.next() * open.length)]!.traits.push(trait);
}

/** Returns why a designate_heir decision is invalid, or null if it can go ahead. */
export function checkDesignateHeir(state: GameState, d: DesignateHeirDecision, data: GameData): string | null {
  const noAction = checkActionLeft(state, data.tuning);
  if (noAction) return noAction;
  const heir = heirsOf(state).find((p) => p.id === d.heir);
  if (!heir) return `No living heir #${d.heir}`;
  if (state.house.designated_heir === heir.id) return `${heir.name} is already the named heir`;
  return null;
}

/** Names the heir who will take over. No money moves. Returns a new state; the input is not changed. */
export function designateHeir(state: GameState, d: DesignateHeirDecision, data: GameData): DecisionResult {
  const reason = checkDesignateHeir(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  next.house.designated_heir = d.heir;
  next.actions_this_turn += 1;
  return { ok: true, state: next };
}
