import type { Tuning } from "./tuning";
import type { GameState } from "./types";

/** Outcome of applying one decision. A refusal carries the reason instead of throwing. */
export type DecisionResult = { ok: true; state: GameState } | { ok: false; reason: string };

export function actionsLeft(state: GameState, tuning: Tuning): number {
  return Math.max(0, tuning.actions_per_turn - state.actions_this_turn);
}

/** Returns a reason if the turn's actions are used up, or null if one is left. */
export function checkActionLeft(state: GameState, tuning: Tuning): string | null {
  if (state.house.status === "bankrupt") return "The house is bankrupt";
  if (actionsLeft(state, tuning) > 0) return null;
  return `No actions left this turn (max ${tuning.actions_per_turn})`;
}
