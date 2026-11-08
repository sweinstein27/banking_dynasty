// C3, war and revolution: wars as campaigns over several quarters; unrest building to 1830 and 1848. A seam for parallel work: the war session owns this file and data/war.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/war.json */
export type WarData = Record<string, never>;
/** state.war */
export type WarState = Record<string, never>;
export type WarDecision = never;
export type WarCategory = never;
/** Ledger accounts this system holds (if any), counted in net worth through `warBook`. */
export type WarAccount = never;

export function createWar(_data: GameData, _rng: Rng): WarState {
  return {};
}

/** The system's End Turn step (see the order in src/sim/turn.ts). Mutates `state`. */
export function resolveWar(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the system's holdings are worth, for net worth. */
export function warBook(_state: GameState): number {
  return 0;
}

export const isWarDecision = (_d: Decision): _d is WarDecision => false;

export function applyWarDecision(_state: GameState, d: WarDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeWarDecision(d: WarDecision, _state: GameState, _data: GameData): string {
  return d;
}
