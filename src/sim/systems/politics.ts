// C2, politics: seats in the Frankfurt Senate and the Federal Diet; court banker to a prince; influence. A seam for parallel work: the politics session owns this file and data/politics.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/politics.json */
export type PoliticsData = Record<string, never>;
/** state.politics */
export type PoliticsState = Record<string, never>;
export type PoliticsDecision = never;
export type PoliticsCategory = never;
/** Ledger accounts this system holds (if any), counted in net worth through `politicsBook`. */
export type PoliticsAccount = never;

export function createPolitics(_data: GameData, _rng: Rng): PoliticsState {
  return {};
}

/** The system's End Turn step (see the order in src/sim/turn.ts). Mutates `state`. */
export function resolvePolitics(_state: GameState, _rng: Rng, _data: GameData): void {}

/** What the system's holdings are worth, for net worth. */
export function politicsBook(_state: GameState): number {
  return 0;
}

export const isPoliticsDecision = (_d: Decision): _d is PoliticsDecision => false;

export function applyPoliticsDecision(_state: GameState, d: PoliticsDecision, _data: GameData): DecisionResult {
  return d;
}

export function describePoliticsDecision(d: PoliticsDecision, _state: GameState, _data: GameData): string {
  return d;
}
