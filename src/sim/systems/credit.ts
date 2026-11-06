// Credit (milestone A1): borrowers' books, tiered reports, loans of many lengths, selling loans.
// A seam for parallel work: the credit session owns this file and data/credit.json. Until then
// every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/credit.json */
export type CreditData = Record<string, never>;
/** state.credit */
export type CreditState = Record<string, never>;
/** Decisions this system adds. */
export type CreditDecision = never;
/** Ledger categories this system adds. */
export type CreditCategory = never;

export function createCredit(_data: GameData, _rng: Rng): CreditState {
  return {};
}

/** The system's End Turn step, after loans are serviced. Mutates `state`. */
export function resolveCredit(_state: GameState, _rng: Rng, _data: GameData): void {}

export const isCreditDecision = (_d: Decision): _d is CreditDecision => false;

export function applyCreditDecision(_state: GameState, d: CreditDecision, _data: GameData): DecisionResult {
  return d;
}

/** One line for a queued decision of this system. */
export function describeCreditDecision(d: CreditDecision, _state: GameState, _data: GameData): string {
  return d;
}
