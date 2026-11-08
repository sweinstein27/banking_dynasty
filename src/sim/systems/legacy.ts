// B3, legacy: ambitions each decade, titles, and a prestige score across wealth, standing, family, influence and legacy. A seam for parallel work: the legacy session owns this file and data/legacy.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/legacy.json */
export type LegacyData = Record<string, never>;
/** state.legacy */
export type LegacyState = Record<string, never>;
export type LegacyDecision = never;
export type LegacyCategory = never;
/** Ledger accounts this system holds (if any), counted in net worth through `legacyBook`. */
export type LegacyAccount = never;

export function createLegacy(_data: GameData, _rng: Rng): LegacyState {
  return {};
}

/** The system's End Turn step (see the order in src/sim/turn.ts). Mutates `state`. */
export function resolveLegacy(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the system's holdings are worth, for net worth. */
export function legacyBook(_state: GameState): number {
  return 0;
}

export const isLegacyDecision = (_d: Decision): _d is LegacyDecision => false;

export function applyLegacyDecision(_state: GameState, d: LegacyDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeLegacyDecision(d: LegacyDecision, _state: GameState, _data: GameData): string {
  return d;
}
