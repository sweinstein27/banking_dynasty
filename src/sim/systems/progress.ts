// C4, progress: technology waves (steam, railways, telegraph, gas) opening ventures and speeding news. A seam for parallel work: the progress session owns this file and data/progress.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/progress.json */
export type ProgressData = Record<string, never>;
/** state.progress */
export type ProgressState = Record<string, never>;
export type ProgressDecision = never;
export type ProgressCategory = never;

export function createProgress(_data: GameData, _rng: Rng): ProgressState {
  return {};
}

/** The system's End Turn step, after the quarter's events fire. Mutates `state`. */
export function resolveProgress(_state: GameState, _rng: Rng, _data: GameData): void {}

export const isProgressDecision = (_d: Decision): _d is ProgressDecision => false;

export function applyProgressDecision(_state: GameState, d: ProgressDecision, _data: GameData): DecisionResult {
  return d;
}

export function describeProgressDecision(d: ProgressDecision, _state: GameState, _data: GameData): string {
  return d;
}
