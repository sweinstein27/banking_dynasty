// B1, rivals that act: houses bid for contracts, poach staff, buy your debts; schemes for you and for them. A seam for parallel work: the rivals session owns this file and data/rivals.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/rivals.json */
export type RivalsData = Record<string, never>;
/** state.rivals */
export type RivalsState = Record<string, never>;
export type RivalsDecision = never;
export type RivalsCategory = never;
/** Ledger accounts this system holds (if any), counted in net worth through `rivalsBook`. */
export type RivalsAccount = never;

export function createRivals(_data: GameData, _rng: Rng): RivalsState {
  return {};
}

/** The system's End Turn step (see the order in src/sim/turn.ts). Mutates `state`. */
export function resolveRivals(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the system's holdings are worth, for net worth. */
export function rivalsBook(_state: GameState): number {
  return 0;
}

export const isRivalsDecision = (_d: Decision): _d is RivalsDecision => false;

export function applyRivalsDecision(_state: GameState, d: RivalsDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeRivalsDecision(d: RivalsDecision, _state: GameState, _data: GameData): string {
  return d;
}
