// A5, high finance: sovereign loan contracts, lending to other houses, bankruptcy auctions, insurance. A seam for parallel work: the finance session owns this file and data/finance.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/finance.json */
export type FinanceData = Record<string, never>;
/** state.finance */
export type FinanceState = Record<string, never>;
export type FinanceDecision = never;
export type FinanceCategory = never;
/** Ledger accounts this system adds. */
export type FinanceAccount = never;

export function createFinance(_data: GameData, _rng: Rng): FinanceState {
  return {};
}

/** The system's End Turn step, after markets resolve. Mutates `state`. */
export function resolveFinance(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the house's holdings in this system are worth, for net worth. */
export function financeBook(_state: GameState): number {
  return 0;
}

export const isFinanceDecision = (_d: Decision): _d is FinanceDecision => false;

export function applyFinanceDecision(_state: GameState, d: FinanceDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeFinanceDecision(d: FinanceDecision, _state: GameState, _data: GameData): string {
  return d;
}
