import type { DecisionResult } from "./actions";
import { buyBond } from "./bonds";
import { lend } from "./loans";
import { setReserve } from "./reserves";
import { investVenture } from "./ventures";
import type { GameData } from "./tuning";
import type { Decision, GameState } from "./types";

/** Applies one decision of any kind. Returns a new state, or the reason it was refused. */
export function applyDecision(state: GameState, d: Decision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "lend":
      return lend(state, d, data);
    case "set_reserve":
      return setReserve(state, d, data.tuning);
    case "buy_bond":
      return buyBond(state, d, data);
    case "invest_venture":
      return investVenture(state, d, data);
  }
}
