// Markets (milestone A3): shares, utilities, commodities, long ventures that list as companies,
// harvests. A seam for parallel work: the markets session owns this file and data/markets.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/markets.json */
export type MarketsData = Record<string, never>;
/** state.markets */
export type MarketsState = Record<string, never>;
export type MarketsDecision = never;
export type MarketsCategory = never;
/** Ledger accounts this system adds (such as shares and commodities). */
export type MarketsAccount = never;

export function createMarkets(_data: GameData, _rng: Rng): MarketsState {
  return {};
}

/** The system's End Turn step (prices, dividends, harvests), after ventures resolve. Mutates `state`. */
export function resolveMarkets(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the house's holdings in this system are worth, for net worth. */
export function marketsBook(_state: GameState): number {
  return 0;
}

export const isMarketsDecision = (_d: Decision): _d is MarketsDecision => false;

export function applyMarketsDecision(_state: GameState, d: MarketsDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeMarketsDecision(d: MarketsDecision, _state: GameState, _data: GameData): string {
  return d;
}
