// C3, war and revolution: historical campaigns in dated phases (mobilizing, fighting, settling) that
// move states' risk and trade, shock prices, and set theatre cities at war through C1's history;
// war loans the states ask of the house; unrest pressure that builds toward 1830 and 1848 in every
// city; and Frankfurt's own troubles (1819, 1833, 1848). The pieces live in src/sim/war/.
import type { DecisionResult } from "../actions";
import { nextQuarter } from "../events";
import { fl } from "../format";
import { createRng, type Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";
import { advanceCampaigns, createWarState, rollHome, rollPressure, stateName, syncEffects, warPhaseOf } from "../war/campaigns";
import { serviceWarLoans, subscribeWarLoan, warLoansBook } from "../war/loans";
import { WAR_KINDS, type WarDecision, type WarState } from "../war/types";

export type { WarAccount, WarCategory, WarData, WarDecision, WarState } from "../war/types";
export { openOffers, raiseFromWar, warLoansBook } from "../war/loans";
export { warPhaseOf } from "../war/campaigns";

/**
 * The war system at the start: campaigns already under way (the Hundred Days) stand in their
 * phase. Its own random stream is seeded from the run's RNG state without drawing from it.
 */
export function createWar(data: GameData, rng: Rng): WarState {
  const seed = "state" in rng && typeof rng.state === "number" ? (rng.state ^ 0x0c3_3a12) >>> 0 : Math.floor(rng.next() * 0x100000000);
  return createWarState(data, seed);
}

function withWarRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.war.rng_state);
  const out = fn(rng);
  state.war.rng_state = rng.state;
  return out;
}

/**
 * The system's End Turn step, just before Europe's. 1. War loans pay interest, and those due are
 * repaid or fail (one roll each); 2. campaigns move to their stage for next quarter (news, shocks,
 * one fortune roll per state at war while fighting); 3. every city's unrest pressure (one roll
 * each); 4. Frankfurt's own quarter (one roll); 5. risk and trade brought to what the war wants.
 * Mutates `state`.
 */
export function resolveWar(state: GameState, _rng: Rng, data: GameData): void {
  if (state.house.status === "bankrupt") return;
  const next = nextQuarter(state.world);
  withWarRng(state, (rng) => {
    serviceWarLoans(state, rng, data);
    advanceCampaigns(state, rng, data, next);
    rollPressure(state, rng, data, next);
    rollHome(state, rng, data, next);
  });
  syncEffects(state, data);
}

/** What the system's holdings are worth, for net worth: war loans at par. */
export function warBook(state: GameState): number {
  return warLoansBook(state);
}

/** C1 hook: random unrest in a city is this many times as likely (pressure / unrest_scale more). */
export function unrestFactor(state: GameState, cityId: string, data: GameData): number {
  const p = state.war?.pressure?.[cityId] ?? 0;
  return 1 + p / data.war.pressure.unrest_scale;
}

/** For the integrator (finance): a state at war announces loans this many times as often. 1 at peace. */
export function warContractFactor(state: GameState, stateId: string, data: GameData): number {
  const phase = warPhaseOf(state, data, stateId);
  return phase ? data.war.hooks.contract_factor[phase] ?? 1 : 1;
}

/** For the integrator (bonds): share off a state's bond price while it is at war, even in a calm market. 0 at peace. */
export function warBondDiscount(state: GameState, stateId: string, data: GameData): number {
  const phase = warPhaseOf(state, data, stateId);
  return phase ? data.war.hooks.bond_discount[phase] ?? 0 : 0;
}

const KINDS: ReadonlySet<string> = new Set(WAR_KINDS);
export const isWarDecision = (d: Decision): d is WarDecision => KINDS.has(d.kind);

export function applyWarDecision(state: GameState, d: WarDecision, data: GameData): DecisionResult {
  return subscribeWarLoan(state, d, data);
}

export function describeWarDecision(d: WarDecision, _state: GameState, data: GameData): string {
  const offer = data.war.campaigns.flatMap((c) => c.offers).find((o) => o.id === d.offer);
  return `Lend ${fl(d.amount)} to ${offer ? stateName(data, offer.borrower) : d.offer} for the war`;
}
