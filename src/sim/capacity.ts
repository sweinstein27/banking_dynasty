// How much the house can do in a quarter. Today: a fixed number of actions a turn
// (tuning.actions_per_turn). The counting-house session (A2) replaces this with capacity from staff
// and facilities; every decision checks and uses capacity only through these three functions.
import { runOver } from "./actions";
import type { Tuning } from "./tuning";
import type { Decision, GameState } from "./types";

/** Capacity left this quarter, in the units the UI shows (today: actions). */
export function capacityLeft(state: GameState, tuning: Tuning): number {
  return Math.max(0, tuning.actions_per_turn - state.actions_this_turn);
}

/** Why a decision of this kind can't be taken now (the run is over, or no capacity is left), or null. */
export function checkCapacity(state: GameState, _kind: Decision["kind"], tuning: Tuning): string | null {
  const over = runOver(state, tuning);
  if (over === "bankrupt") return "The house is bankrupt";
  if (over === "finished") return "The run is over";
  if (capacityLeft(state, tuning) > 0) return null;
  return `No actions left this turn (max ${tuning.actions_per_turn})`;
}

/** Records that a decision of this kind used capacity. Mutates `state` (a draft copy). */
export function useCapacity(state: GameState, _kind: Decision["kind"], _tuning: Tuning): void {
  state.actions_this_turn += 1;
}
