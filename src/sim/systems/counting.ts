// The counting house (milestone A2): staff, facilities, wages, upkeep and capacity, advisors.
// A seam for parallel work: the counting-house session owns this file, src/sim/capacity.ts and
// data/counting.json. Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/counting.json */
export type CountingData = Record<string, never>;
/** state.counting */
export type CountingState = Record<string, never>;
export type CountingDecision = never;
export type CountingCategory = never;

export function createCounting(_data: GameData, _rng: Rng): CountingState {
  return {};
}

/** The system's End Turn step (wages and upkeep), after debts are serviced. Mutates `state`. */
export function resolveCounting(_state: GameState, _rng: Rng, _data: GameData): void {}

export const isCountingDecision = (_d: Decision): _d is CountingDecision => false;

export function applyCountingDecision(_state: GameState, d: CountingDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeCountingDecision(d: CountingDecision, _state: GameState, _data: GameData): string {
  return d;
}
