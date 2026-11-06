// The other Frankfurt houses. Their books are not modelled: each has a head and an heir, wealth that
// moves with its temperament and the market, a reputation, and an opinion of the player's house.
// A house can fail in a panic, and some of its depositors then come to the player.
import { checkActionLeft, type DecisionResult } from "./actions";
import { ageIn, quarterlyDeathChance } from "./family";
import { fl } from "./format";
import { addEntry } from "./ledger";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import { freeCash } from "./reserves";
import { cloneState } from "./state";
import type { CourtHouseDecision, GameState, OtherHouse } from "./types";

/** The houses at the start of a game, from data/houses.json. Draws nothing. */
export function createHouses(data: GameData): OtherHouse[] {
  return data.houses.houses.map((h) => ({
    id: h.id,
    name: h.name,
    surname: h.surname,
    temperament: h.temperament,
    head: { ...h.head },
    heir: { ...h.heir },
    wealth: h.wealth,
    start_wealth: h.wealth,
    reputation: h.reputation,
    opinion: h.opinion,
    baseline: h.opinion,
    failed_turn: null,
  }));
}

/** Houses still trading. */
export const tradingHouses = (state: GameState) => state.houses.filter((h) => h.failed_turn === null);

const clampOpinion = (n: number, tuning: Tuning) => Math.min(tuning.houses.opinion.max, Math.max(tuning.houses.opinion.min, Math.round(n)));

/** Changes one house's opinion of the player, within its limits. Mutates `state`. */
export function changeOpinion(state: GameState, id: string, delta: number, tuning: Tuning): void {
  const h = state.houses.find((x) => x.id === id);
  if (h && h.failed_turn === null) h.opinion = clampOpinion(h.opinion + delta, tuning);
}

/** Opinion as a word, for the Gazette, the terminal and the houses view. */
export function opinionWord(opinion: number): string {
  if (opinion >= 60) return "Warm";
  if (opinion >= 20) return "Friendly";
  if (opinion > -20) return "Neutral";
  if (opinion > -60) return "Cool";
  return "Hostile";
}

/**
 * One quarter for every house still trading, in data order. For each: wealth moves by its
 * temperament's growth, the quarter's mood and noise (one roll), and reputation follows the
 * direction (+1 or -1); opinion drifts toward its baseline; a head old enough to die gets a death
 * roll and is succeeded by the heir; in a panic, a failure roll. Mutates `state`.
 */
export function resolveHouses(state: GameState, rng: Rng, data: GameData): void {
  const t = data.tuning.houses;
  const mood = state.world.sentiment;
  for (const h of tradingHouses(state)) {
    const r = t.growth[h.temperament] + t.shock[mood][h.temperament] + t.noise * (2 * rng.next() - 1);
    h.wealth = Math.max(0, Math.round(h.wealth * (1 + r)));
    h.reputation = Math.min(100, Math.max(0, h.reputation + (r >= 0 ? 1 : -1)));
    h.opinion = clampOpinion(h.opinion + (h.baseline - h.opinion) * t.opinion.drift, data.tuning);

    const age = ageIn(h.head, state.world.year);
    if (age >= data.tuning.family.death.from_age && rng.next() < quarterlyDeathChance(age, data.tuning, 1)) succeedHouse(state, h, data);

    if (mood === "panic") {
      const weakness = Math.min(3, Math.max(0, h.start_wealth / Math.max(1, h.wealth)));
      const chance = t.fail_chance[h.temperament] * Math.max(0.5, weakness);
      if (rng.next() < chance) failHouse(state, h, data.tuning);
    }
  }
}

/** The heir takes over; a new heir is named; opinion moves part of the way back to the baseline. Draws nothing. */
function succeedHouse(state: GameState, h: OtherHouse, data: GameData): void {
  const year = state.world.year;
  h.head = h.heir;
  const used = new Set(state.houses.flatMap((x) => [x.head.name, x.heir.name]));
  const first = data.houses.heir_names.find((n) => !used.has(`${n} ${h.surname}`)) ?? data.houses.heir_names[0]!;
  h.heir = { name: `${first} ${h.surname}`, birth_year: Math.min(year - 1, h.head.birth_year + 25) };
  h.opinion = clampOpinion(h.opinion + (h.baseline - h.opinion) * data.tuning.houses.opinion.succession_reset, data.tuning);
}

/** A house closes its doors. Some of its depositors bring their money to the player, more for a good name. */
function failHouse(state: GameState, h: OtherHouse, tuning: Tuning): void {
  h.failed_turn = state.world.turn;
  if (state.house.status === "bankrupt") return;
  const amount = Math.round((tuning.houses.depositors_share * h.wealth * state.house.reputation) / 100 / 100) * 100;
  if (amount <= 0) return;
  state.house.cash += amount;
  state.house.deposits += amount;
  const note = `Depositors of ${h.name}, which has failed`;
  addEntry(state, "cash", "deposit_inflow", amount, note);
  addEntry(state, "deposits", "deposit_inflow", amount, note);
}

/** Every house still trading and the player's, by wealth (the player's net worth), richest first. */
export function houseRanking(state: GameState, playerWorth: number): { name: string; worth: number; player: boolean }[] {
  return [
    ...tradingHouses(state).map((h) => ({ name: h.name, worth: h.wealth, player: false })),
    { name: state.house.name, worth: playerWorth, player: true },
  ].sort((a, b) => b.worth - a.worth || Number(b.player) - Number(a.player));
}

/** Problems with data/houses.json, as readable lines. Empty means the file is sound. */
export function checkHouseData(data: GameData): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const o = data.tuning.houses.opinion;
  for (const h of data.houses.houses) {
    const p = (msg: string) => problems.push(`${h.id}: ${msg}`);
    if (ids.has(h.id)) p("duplicate id");
    ids.add(h.id);
    if (!h.name || !h.surname) p("needs a name and a surname");
    if (!["cautious", "bold"].includes(h.temperament)) p(`unknown temperament "${h.temperament}"`);
    if (!(h.wealth > 0)) p("wealth must be above zero");
    if (!(h.reputation >= 0 && h.reputation <= 100)) p("reputation must be 0 to 100");
    if (!(h.opinion >= o.min && h.opinion <= o.max)) p(`opinion must be ${o.min} to ${o.max}`);
    if (!h.head.name.endsWith(h.surname) || !h.heir.name.endsWith(h.surname)) p("head and heir carry the house's surname");
    if (/[—–]/.test(JSON.stringify(h))) p("uses a dash; the writing style forbids em dashes");
  }
  if (!data.houses.heir_names.length) problems.push("heir_names is empty");
  return problems;
}

/** Returns why a court_house decision is invalid, or null if it can go ahead. */
export function checkCourtHouse(state: GameState, d: CourtHouseDecision, data: GameData): string | null {
  const noAction = checkActionLeft(state, data.tuning);
  if (noAction) return noAction;
  const h = state.houses.find((x) => x.id === d.house);
  if (!h) return `Unknown house "${d.house}"`;
  if (h.failed_turn !== null) return `${h.name} has failed`;
  if (h.opinion >= data.tuning.houses.opinion.max) return `${h.name} could not think better of your house`;
  const cost = data.tuning.houses.court.cost;
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Courts a house: one action, the cost in cash, its opinion rises. Returns a new state; the input is not changed. */
export function courtHouse(state: GameState, d: CourtHouseDecision, data: GameData): DecisionResult {
  const reason = checkCourtHouse(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const { cost, opinion } = data.tuning.houses.court;
  const h = next.houses.find((x) => x.id === d.house)!;
  next.house.cash -= cost;
  addEntry(next, "cash", "courting", -cost, `Courting ${h.name}`);
  changeOpinion(next, h.id, opinion, data.tuning);
  next.actions_this_turn += 1;
  return { ok: true, state: next };
}
