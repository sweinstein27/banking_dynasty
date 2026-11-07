// C1, Europe: the map, cities and their markets, news that travels by courier, branches run by family members, currencies and bills of exchange. A seam for parallel work: the europe session owns this file and data/europe.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/europe.json */
export type EuropeData = Record<string, never>;
/** state.europe */
export type EuropeState = Record<string, never>;
export type EuropeDecision = never;
export type EuropeCategory = never;
/** Ledger accounts this system adds. */
export type EuropeAccount = never;

export function createEurope(_data: GameData, _rng: Rng): EuropeState {
  return {};
}

/** The system's End Turn step, after markets resolve. Mutates `state`. */
export function resolveEurope(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the house's holdings in this system are worth, for net worth. */
export function europeBook(_state: GameState): number {
  return 0;
}

export const isEuropeDecision = (_d: Decision): _d is EuropeDecision => false;

export function applyEuropeDecision(_state: GameState, d: EuropeDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeEuropeDecision(d: EuropeDecision, _state: GameState, _data: GameData): string {
  return d;
}
