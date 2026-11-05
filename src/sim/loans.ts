import { cloneState } from "./state";
import { fl } from "./format";
import { checkActionLeft, type DecisionResult } from "./actions";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { GameData, Tuning } from "./tuning";
import type { GameState, LendDecision, Loan, Sentiment } from "./types";

/** Returns why a lend decision is invalid, or null if it can go ahead. */
export function checkLend(state: GameState, d: LendDecision, tuning: Tuning): string | null {
  const t = tuning.loans;
  const b = state.borrowers.find((x) => x.id === d.borrower);
  if (!b) return `Unknown borrower #${d.borrower}`;
  const noAction = checkActionLeft(state, tuning);
  if (noAction) return noAction;
  const request = state.requests.find((r) => r.borrower_id === b.id);
  if (!request) return `${b.name} is not asking for a loan this quarter`;
  if (!Number.isInteger(d.amount)) return "Amount must be whole gulden";
  if (d.amount < t.min_amount) return `Amount must be at least ${fl(t.min_amount)}`;
  if (d.amount > request.amount) return `${b.name} wants no more than ${fl(request.amount)}`;
  if (d.amount > freeCash(state)) return notEnoughCash(state);
  if (!(d.rate > 0)) return "Rate must be above zero";
  if (d.rate > request.max_rate) return `${b.name} will not pay more than ${(request.max_rate * 100).toFixed(1)}%`;
  return null;
}

/** Makes a loan: cash moves into the loan book. Returns a new state; the input is not changed. */
export function lend(state: GameState, d: LendDecision, data: GameData): DecisionResult {
  const reason = checkLend(state, d, data.tuning);
  if (reason) return { ok: false, reason };

  const next = cloneState(state);
  const b = next.borrowers.find((x) => x.id === d.borrower)!;
  const loan: Loan = {
    id: next.loans.length + 1,
    borrower_id: b.id,
    borrower_name: b.name,
    principal: d.amount,
    rate: d.rate,
    quality: b.quality,
    start_turn: next.world.turn,
    term_quarters: data.tuning.loans.term_quarters,
    status: "active",
  };
  next.loans.push(loan);
  // One loan per request: the borrower has what they asked for this quarter.
  next.requests = next.requests.filter((r) => r.borrower_id !== b.id);
  next.house.cash -= d.amount;
  next.actions_this_turn += 1;
  const note = `Loan #${loan.id} to ${loan.borrower_name} at ${(d.rate * 100).toFixed(1)}%`;
  addEntry(next, "cash", "loan_out", -d.amount, note);
  addEntry(next, "loans", "loan_out", d.amount, note);
  return { ok: true, state: next };
}

/** One quarter's interest in whole gulden. */
export function quarterlyInterest(loan: Pick<Loan, "principal" | "rate">): number {
  return Math.round((loan.principal * loan.rate) / 4);
}

/** p_default = p0 * m_sentiment * (1 - q) * trade_risk, per quarter. trade_risk is 1 until events change it. */
export function defaultChance(quality: number, sentiment: Sentiment, tuning: Tuning, tradeRisk: number): number {
  return tuning.loans.p0 * tuning.sentiment_multiplier[sentiment] * (1 - quality) * tradeRisk;
}

function notEnoughCash(state: GameState): string {
  const { cash, reserve } = state.house;
  if (reserve === 0) return `Not enough cash (have ${fl(cash)})`;
  return `Not enough cash above the reserve (have ${fl(cash)}, reserve ${fl(reserve)}, free ${fl(freeCash(state))})`;
}
