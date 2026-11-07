import { cloneState } from "./state";
import { fl } from "./format";
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import { recordDefault, recordRepayment } from "./borrowers";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import type { GameState, LendDecision, Loan, Sentiment } from "./types";

/** Returns why a lend decision is invalid, or null if it can go ahead. */
export function checkLend(state: GameState, d: LendDecision, tuning: Tuning): string | null {
  const t = tuning.loans;
  const b = state.borrowers.find((x) => x.id === d.borrower);
  if (!b) return `Unknown borrower #${d.borrower}`;
  const noAction = checkCapacity(state, "lend", tuning);
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
  const request = next.requests.find((r) => r.borrower_id === b.id)!;
  const loan: Loan = {
    id: next.loans.length + 1,
    borrower_id: b.id,
    borrower_name: b.name,
    kind: request.kind,
    principal: d.amount,
    rate: d.rate,
    quality: b.quality,
    start_turn: next.world.turn,
    term_quarters: request.term_quarters,
    status: "active",
  };
  next.loans.push(loan);
  // One loan per request: the borrower has what they asked for this quarter.
  next.requests = next.requests.filter((r) => r.borrower_id !== b.id);
  next.house.cash -= d.amount;
  useCapacity(next, "lend", data.tuning);
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

/**
 * The quarter's loans, oldest first. For each active loan: roll a default (the kind's
 * default_factor times defaultChance; one roll per loan), else collect interest on the principal
 * still owed, then repay what falls due: the whole principal at term, or for a loan that amortizes
 * an equal part of what is left each quarter (the last part at term). Mutates `state`.
 */
export function serviceLoans(state: GameState, rng: Rng, data: GameData): void {
  const { world, house } = state;
  for (const loan of state.loans) {
    if (loan.status !== "active") continue;
    const kind = data.tuning.loans.kinds[loan.kind];

    if (rng.next() < kind.default_factor * defaultChance(loan.quality, world.sentiment, data.tuning, state.trade_risk)) {
      recordDefault(state, loan, `Loan #${loan.id}: ${loan.borrower_name} defaulted`, data.tuning);
      continue;
    }

    const interest = quarterlyInterest(loan);
    house.cash += interest;
    addEntry(state, "cash", "interest", interest, `Loan #${loan.id}: interest from ${loan.borrower_name}`);

    const quartersElapsed = world.turn - loan.start_turn + 1;
    if (quartersElapsed >= loan.term_quarters) {
      const note = `Loan #${loan.id}: ${loan.borrower_name} repaid`;
      house.cash += loan.principal;
      addEntry(state, "cash", "repayment", loan.principal, note);
      addEntry(state, "loans", "repayment", -loan.principal, note);
      loan.status = "repaid";
      recordRepayment(state, loan, data.tuning);
    } else if (kind.amortizes) {
      const part = Math.round(loan.principal / (loan.term_quarters - quartersElapsed + 1));
      if (part <= 0) continue;
      const note = `Loan #${loan.id}: ${loan.borrower_name} repaid part of the principal`;
      loan.principal -= part;
      house.cash += part;
      addEntry(state, "cash", "principal_part", part, note);
      addEntry(state, "loans", "principal_part", -part, note);
    }
  }
}

function notEnoughCash(state: GameState): string {
  const { cash, reserve } = state.house;
  if (reserve === 0) return `Not enough cash (have ${fl(cash)})`;
  return `Not enough cash above the reserve (have ${fl(cash)}, reserve ${fl(reserve)}, free ${fl(freeCash(state))})`;
}
