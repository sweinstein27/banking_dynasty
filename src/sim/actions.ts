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
