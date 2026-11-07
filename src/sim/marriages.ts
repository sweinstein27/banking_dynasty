// Marriages: a member of the line marries into another house's family, a house's son or daughter
// marries into this one, or a spouse comes from a merchant family outside the bourse. Matches bring
// dowries and alliances; children need a married couple (see resolveFamily).
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { ageIn, person } from "./family";
import { fl } from "./format";
import { changeOpinion } from "./houses";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import { cloneState } from "./state";
import { houseTerms } from "./systems/counting";
import type { GameData } from "./tuning";
import type { ArrangeMarriageDecision, GameState, OtherHouse, Person } from "./types";

/** Ids of the houses tied to this one by a marriage. */
export function allies(state: GameState): Set<string> {
  return new Set(state.marriages.filter((m) => m.house !== "merchant").map((m) => m.house));
}

/** Members of the line who may marry now: living, of age, with no living spouse. */
export function marriageable(state: GameState, data: GameData): Person[] {
  const { year } = state.world;
  return state.people.filter(
    (p) => p.role === "line" && p.death_year === null && ageIn(p, year) >= data.tuning.family.marriage.min_age && !hasLivingSpouse(state, p),
  );
}

function hasLivingSpouse(state: GameState, p: Person): boolean {
  return p.spouse !== null && state.people.some((x) => x.id === p.spouse && x.death_year === null);
}

/** The dowry a house pays when its son or daughter marries in: a share of its wealth, to the nearest 100 fl. */
export function dowryIn(h: OtherHouse, data: GameData): number {
  return Math.round((h.wealth * data.tuning.family.marriage.in.dowry_share) / 100) * 100;
}

/** Money a match moves: positive comes in, negative goes out. */
export function matchMoney(state: GameState, d: Pick<ArrangeMarriageDecision, "with" | "form">, data: GameData): number {
  const m = data.tuning.family.marriage;
  // A partner (the counting house) makes what the house pays cheaper.
  const pay = (n: number) => -Math.round(n * houseTerms(state, data).cost_factor);
  if (d.with === "merchant") return pay(m.merchant.cost);
  const h = state.houses.find((x) => x.id === d.with);
  if (!h) return 0;
  return d.form === "in" ? dowryIn(h, data) : pay(m.out.dowry);
}

/** Returns why a match is refused, or null if it can go ahead. */
export function checkMarriage(state: GameState, d: ArrangeMarriageDecision, data: GameData): string | null {
  const noAction = checkCapacity(state, "arrange_marriage", data.tuning);
  if (noAction) return noAction;
  const m = data.tuning.family.marriage;
  const p = state.people.find((x) => x.id === d.member);
  if (!p || p.role !== "line" || p.death_year !== null) return `No living member of the line #${d.member}`;
  if (ageIn(p, state.world.year) < m.min_age) return `${p.name} is too young to marry (aged ${ageIn(p, state.world.year)}, needs ${m.min_age})`;
  if (hasLivingSpouse(state, p)) return `${p.name} is already married`;
  if (d.form === "out" && p.is_head) return "The head of the house cannot marry out of it";
  const cost = -matchMoney(state, d, data);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  if (d.with === "merchant") return d.form === "in" ? null : "A merchant's family marries into this house, not the other way";
  const h = state.houses.find((x) => x.id === d.with);
  if (!h) return `Unknown house "${d.with}"`;
  if (h.failed_turn !== null) return `${h.name} has failed`;
  const terms = d.form === "in" ? m.in : m.out;
  // Reception rooms (the counting house) make houses readier to agree.
  const needs = terms.min_opinion - houseTerms(state, data).marriage_opinion;
  if (h.opinion < needs) return `${h.name} will not hear of a match (opinion ${h.opinion}, needs ${needs})`;
  if (d.form === "in" && state.house.reputation < h.reputation - m.in.reputation_gap)
    return `${h.name} thinks your house beneath it (reputation ${state.house.reputation}, needs ${h.reputation - m.in.reputation_gap})`;
  return null;
}

/**
 * Arranges a match. "in": a spouse from the house (or a merchant family) joins this one, with stats
 * set by the house's reputation (a merchant's spouse: `merchant.stat`) and the house's family trait;
 * the house pays a dowry, and its opinion and baseline rise. "out": the heir leaves the line for the
 * other house; this house pays the dowry; opinion and baseline rise more. One action. Draws nothing.
 * Returns a new state; the input is not changed.
 */
export function arrangeMarriage(state: GameState, d: ArrangeMarriageDecision, data: GameData): DecisionResult {
  const reason = checkMarriage(state, d, data);
  if (reason) return { ok: false, reason };
  const m = data.tuning.family.marriage;
  const next = cloneState(state);
  const member = next.people.find((x) => x.id === d.member)!;
  const h = next.houses.find((x) => x.id === d.with);
  const money = matchMoney(next, d, data);
  const name = h ? h.name : "a merchant family";
  useCapacity(next, "arrange_marriage", data.tuning);
  if (money !== 0) {
    next.house.cash += money;
    addEntry(next, "cash", "dowry", money, money > 0 ? `Dowry from ${name}: ${member.name}'s marriage` : `${member.name}'s marriage into ${name}`);
  }

  if (d.form === "out") {
    member.role = "left";
    member.origin = h!.id;
    if (next.house.designated_heir === member.id) next.house.designated_heir = null;
    changeOpinion(next, h!.id, m.out.opinion, data.tuning);
    h!.baseline = Math.min(data.tuning.houses.opinion.max, h!.baseline + m.out.baseline);
    next.marriages.push({ turn: next.world.turn, member: member.id, spouse: null, house: h!.id, form: "out", dowry: money });
    return { ok: true, state: next };
  }

  const gender = member.gender === "m" ? "f" : "m";
  const used = new Set(next.people.map((p) => p.name.split(" ")[0]));
  const first = data.family.spouse_names[gender].find((n) => !used.has(n)) ?? data.family.spouse_names[gender][0]!;
  // Close in age: a husband two years older, a wife two years younger, and never under age.
  const born = Math.min(next.world.year - m.min_age, member.birth_year + (gender === "m" ? -2 : 2));
  const { min, max } = data.tuning.family.spouse_stats;
  const stat = h ? Math.min(max, Math.max(min, 2 + Math.floor(h.reputation / 25))) : m.merchant.stat;
  const trait = h ? data.houses.houses.find((x) => x.id === h.id)?.spouse_trait : undefined;
  const spouse: Person = {
    ...person(next.people.length + 1, `${first} ${data.family.surname}`, gender, born, "spouse"),
    acumen: stat, prudence: stat, connections: stat, traits: trait ? [trait] : [],
    spouse: member.id, origin: h ? h.id : "merchant", born: h ? h.surname : null,
  };
  next.people.push(spouse);
  member.spouse = spouse.id;
  if (h) {
    changeOpinion(next, h.id, m.in.opinion, data.tuning);
    h.baseline = Math.min(data.tuning.houses.opinion.max, h.baseline + m.in.baseline);
  }
  next.marriages.push({ turn: next.world.turn, member: member.id, spouse: spouse.id, house: h ? h.id : "merchant", form: h ? "in" : "merchant", dowry: money });
  return { ok: true, state: next };
}
