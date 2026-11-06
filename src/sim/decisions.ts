import type { DecisionResult } from "./actions";
import { buyBond } from "./bonds";
import { buyReport } from "./borrowers";
import { applyCrisis } from "./crisis";
import { designateHeir, investFamily } from "./family";
import { answerLetter } from "./letters";
import { courtHouse } from "./houses";
import { lend } from "./loans";
import { arrangeMarriage } from "./marriages";
import { setReserve } from "./reserves";
import { investVenture } from "./ventures";
import type { GameData } from "./tuning";
import { applyCountingDecision, describeCountingDecision, isCountingDecision } from "./systems/counting";
import { applyCreditDecision, describeCreditDecision, isCreditDecision } from "./systems/credit";
import { applyMarketsDecision, describeMarketsDecision, isMarketsDecision } from "./systems/markets";
import type { CoreDecision, Decision, GameState } from "./types";

/** Applies one decision of any kind, each system's own first. Returns a new state, or the reason it was refused. */
export function applyDecision(state: GameState, d: Decision, data: GameData): DecisionResult {
  if (isCreditDecision(d)) return applyCreditDecision(state, d, data);
  if (isCountingDecision(d)) return applyCountingDecision(state, d, data);
  if (isMarketsDecision(d)) return applyMarketsDecision(state, d, data);
  return applyCoreDecision(state, d, data);
}

/** A one-line description of a system's decision, or null for a core decision (the UI and terminal describe those). */
export function describeSystemDecision(d: Decision, state: GameState, data: GameData): string | null {
  if (isCreditDecision(d)) return describeCreditDecision(d, state, data);
  if (isCountingDecision(d)) return describeCountingDecision(d, state, data);
  if (isMarketsDecision(d)) return describeMarketsDecision(d, state, data);
  return null;
}

function applyCoreDecision(state: GameState, d: CoreDecision, data: GameData): DecisionResult {
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
    case "answer_letter":
      return answerLetter(state, d, data);
    case "court_house":
      return courtHouse(state, d, data);
    case "arrange_marriage":
      return arrangeMarriage(state, d, data);
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
