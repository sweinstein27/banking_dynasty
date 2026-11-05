import type { Tuning } from "./tuning";
import type { GameState } from "./types";

/** Outcome of applying one decision. A refusal carries the reason instead of throwing. */
export type DecisionResult = { ok: true; state: GameState } | { ok: false; reason: string };

/** Why the run has ended, or null while it goes on. "finished" means the last quarter in tuning.end has been played. */
export function runOver(state: GameState, tuning: Tuning): "bankrupt" | "finished" | null {
  if (state.house.status === "bankrupt") return "bankrupt";
  const { year, quarter } = state.world;
  const { end } = tuning;
  if (year > end.year || (year === end.year && quarter > end.quarter)) return "finished";
  return null;
}

export function actionsLeft(state: GameState, tuning: Tuning): number {
  return Math.max(0, tuning.actions_per_turn - state.actions_this_turn);
}

/** Returns a reason if the turn's actions are used up, or null if one is left. */
export function checkActionLeft(state: GameState, tuning: Tuning): string | null {
  const over = runOver(state, tuning);
  if (over === "bankrupt") return "The house is bankrupt";
  if (over === "finished") return "The run is over";
  if (actionsLeft(state, tuning) > 0) return null;
  return `No actions left this turn (max ${tuning.actions_per_turn})`;
}
