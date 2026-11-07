// B2, people with agendas: personalities, loyalty, succession claims and feuds, education paths. A seam for parallel work: the people session owns this file and data/people.json.
// Until then every hook here is empty and changes nothing.
import type { DecisionResult } from "../actions";
import type { Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";

/** data/people.json */
export type PeopleData = Record<string, never>;
/** state.agendas (the family itself is state.people) */
export type PeopleState = Record<string, never>;
export type PeopleDecision = never;
export type PeopleCategory = never;

export function createPeople(_data: GameData, _rng: Rng): PeopleState {
  return {};
}

/** The system's End Turn step, after the family's quarter. Mutates `state`. */
export function resolvePeople(_state: GameState, _rng: Rng, _data: GameData): void {}

export const isPeopleDecision = (_d: Decision): _d is PeopleDecision => false;

export function applyPeopleDecision(_state: GameState, d: PeopleDecision, _data: GameData): DecisionResult {
  return d;
}

export function describePeopleDecision(d: PeopleDecision, _state: GameState, _data: GameData): string {
  return d;
}
