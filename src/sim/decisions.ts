import type { DecisionResult } from "./actions";
import { buyBond } from "./bonds";
import { buyReport } from "./borrowers";
import { applyCrisis } from "./crisis";
import { designateHeir, investFamily } from "./family";
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
    case "report":
      return buyReport(state, d, data);
    case "set_reserve":
      return setReserve(state, d, data.tuning);
    case "buy_bond":
      return buyBond(state, d, data);
    case "invest_venture":
      return investVenture(state, d, data);
    case "invest_family":
      return investFamily(state, d, data);
    case "designate_heir":
      return designateHeir(state, d, data);
    case "borrow":
    case "pay_slowly":
    case "suspend":
    case "call_loan":
      return applyCrisis(state, d, data);
  }
}

/** Applies decisions in order, stopping at the first refusal. */
export function applyDecisions(state: GameState, ds: Decision[], data: GameData): DecisionResult {
  let next = state;
  for (const d of ds) {
    const r = applyDecision(next, d, data);
    if (!r.ok) return r;
    next = r.state;
  }
  return { ok: true, state: next };
}
