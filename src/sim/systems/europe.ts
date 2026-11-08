// C1, Europe: cities and the courier roads between them, each with its own mood, troubles and
// currency; news that travels by courier; branches run by family members; bills of exchange.
// The pieces live in src/sim/europe/; this file is the system's seam.
import type { DecisionResult } from "../actions";
import { nextQuarter } from "../events";
import { fl } from "../format";
import { createRng, type Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";
import { billsBook, branchDisaster, branchesBook, europeAppliers, revalue, rollBills, runBranches, settleBills } from "../europe/branches";
import { EUROPE_KINDS, type EuropeDecision, type EuropeState } from "../europe/types";
import { cityData, createWorld, deliverMail, rollCities } from "../europe/world";

export type { EuropeAccount, EuropeCategory, EuropeData, EuropeDecision, EuropeState } from "../europe/types";
export { newsDelay, quote, trueRate, roadDays } from "../europe/world";

/**
 * Europe at the start: every city calm and at peace, every rate at par. Its own random stream is
 * seeded from the run's RNG state without drawing from it, so other systems' rolls do not move.
 */
export function createEurope(data: GameData, rng: Rng): EuropeState {
  const seed = "state" in rng && typeof rng.state === "number" ? (rng.state ^ 0x5eed_c1e0) >>> 0 : Math.floor(rng.next() * 0x100000000);
  return createWorld(data, seed);
}

/** Runs `fn` with Europe's own stream and stores where it got to. */
function withEuropeRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.europe.rng_state);
  const out = fn(rng);
  state.europe.rng_state = rng.state;
  return out;
}

/**
 * The system's End Turn step, after markets resolve. 1. Branches do the quarter's business under
 * their cities as they stood this quarter, and may be forced to close (one roll each); 2. the
 * payers of bills due this quarter may fail (one roll each); 3. every city is rolled for the next
 * quarter (rates, moods, troubles, dated happenings) and writes a dispatch; 4. dispatches that reach
 * Frankfurt by the start of next quarter are read (the news, and the house's view of each city);
 * 5. bills due are paid home at the Frankfurt quote, and branches are revalued at it. Mutates `state`.
 */
export function resolveEurope(state: GameState, _rng: Rng, data: GameData): void {
  if (state.house.status === "bankrupt") return;
  withEuropeRng(state, (rng) => {
    runBranches(state, rng, data);
    const failed = rollBills(state, rng, data);
    rollCities(state, rng, data, nextQuarter(state.world), (city, loss, title) => branchDisaster(state, city, loss, title, data));
    deliverMail(state);
    settleBills(state, failed, data);
    for (const b of state.europe.branches) revalue(state, b, data);
  });
}

/** What the house's holdings in this system are worth, for net worth: branches at the Frankfurt quote, bills at cost. */
export function europeBook(state: GameState): number {
  return branchesBook(state) + billsBook(state);
}

const KINDS: ReadonlySet<string> = new Set(EUROPE_KINDS);
export const isEuropeDecision = (d: Decision): d is EuropeDecision => KINDS.has(d.kind);

export function applyEuropeDecision(state: GameState, d: EuropeDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "open_branch":
      return europeAppliers.open_branch(state, d, data);
    case "fund_branch":
      return europeAppliers.fund_branch(state, d, data);
    case "appoint_branch_head":
      return europeAppliers.appoint_branch_head(state, d, data);
    case "close_branch":
      return europeAppliers.close_branch(state, d, data);
    case "buy_bill":
      return europeAppliers.buy_bill(state, d, data);
  }
}

export function describeEuropeDecision(d: EuropeDecision, state: GameState, data: GameData): string {
  const city = cityData(data, d.city)?.name ?? d.city;
  const who = (id: number) => state.people.find((p) => p.id === id)?.name ?? `#${id}`;
  switch (d.kind) {
    case "open_branch":
      return `Open a branch in ${city} under ${who(d.head)}, with ${fl(d.capital)} of capital`;
    case "fund_branch":
      return d.amount > 0 ? `Send ${fl(d.amount)} to the ${city} branch` : `Recall ${fl(-d.amount)} from the ${city} branch`;
    case "appoint_branch_head":
      return `Put ${who(d.head)} at the head of the ${city} branch`;
    case "close_branch":
      return `Close the ${city} branch`;
    case "buy_bill":
      return `Buy ${fl(d.amount)} of 3-month bills on ${city}`;
  }
}
