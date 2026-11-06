// Crisis responses: what the house can do when the market is uneasy, panicking, or under a panic
// warning. Borrow from another house, pay depositors slowly, suspend withdrawals, or call a loan in.
import { cloneState } from "./state";
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { fl } from "./format";
import { changeOpinion } from "./houses";
import { addEntry } from "./ledger";
import { raiseCash } from "./liquidity";
import type { GameData, Tuning } from "./tuning";
import type { CrisisDecision, Debt, GameState, OtherHouse } from "./types";

/** True while the market is uneasy or panicking, or a panic warning is running. */
export function inCrisis(state: GameState): boolean {
  return state.world.sentiment !== "calm" || state.panic_warning !== null;
}

/** Principal the house still owes. */
export function debtBook(state: GameState): number {
  return state.debts.filter((d) => d.status === "active").reduce((sum, d) => sum + d.principal, 0);
}

/** One quarter's interest on a debt, in whole gulden. */
export function debtInterest(d: Pick<Debt, "principal" | "rate">): number {
  return Math.round((d.principal * d.rate) / 4);
}

/** Most the house can still borrow from all houses together. */
export function borrowingRoom(state: GameState, tuning: Tuning): number {
  return Math.max(0, tuning.crisis.lending.max_outstanding - debtBook(state));
}

/** What one house will lend: its rate and room, or why it won't. */
export interface LendingTerms {
  house: OtherHouse;
  rate: number;
  /** Most it will lend now (0 if it refuses). */
  room: number;
  refused: string | null;
}

/** One house's terms: the rate falls as its opinion rises; it lends up to a share of its wealth, within the overall cap. */
export function lendingTerms(state: GameState, h: OtherHouse, tuning: Tuning): LendingTerms {
  const l = tuning.crisis.lending;
  const rate = Math.round((l.base_rate - (l.rate_per_opinion * h.opinion) / 100) * 1000) / 1000;
  const owed = state.debts.filter((d) => d.status === "active" && d.house === h.id).reduce((sum, d) => sum + d.principal, 0);
  const room = Math.max(0, Math.min(borrowingRoom(state, tuning), Math.floor((h.wealth * l.wealth_share) / 100) * 100 - owed));
  let refused: string | null = null;
  if (h.failed_turn !== null) refused = `${h.name} has failed`;
  else if (h.opinion < l.min_opinion) refused = `${h.name} thinks too poorly of your house to lend (opinion ${h.opinion}, needs ${l.min_opinion})`;
  else if (room < l.min_amount) refused = `${h.name} will lend no more (room ${fl(room)})`;
  return { house: h, rate, room: refused ? 0 : room, refused };
}

/** Every house's terms, cheapest willing lender first, then those who refuse. */
export function lenders(state: GameState, tuning: Tuning): LendingTerms[] {
  return state.houses
    .filter((h) => h.failed_turn === null)
    .map((h) => lendingTerms(state, h, tuning))
    .sort((a, b) => Number(a.refused !== null) - Number(b.refused !== null) || a.rate - b.rate || a.house.id.localeCompare(b.house.id));
}

/** Loss a called loan takes: principal minus what the borrower pays back now. */
export function callRecovery(principal: number, tuning: Tuning): number {
  return Math.round(principal * tuning.crisis.call_loan.recovery);
}

/** Returns why a crisis response is invalid, or null if it can go ahead. */
export function checkCrisis(state: GameState, d: CrisisDecision, tuning: Tuning): string | null {
  const noAction = checkCapacity(state, d.kind, tuning);
  if (noAction) return noAction;
  if (!inCrisis(state)) return "Crisis measures are only open while the market is uneasy, panicking, or under a panic warning";
  const c = tuning.crisis;
  switch (d.kind) {
    case "borrow": {
      if (!Number.isInteger(d.amount)) return "Amount must be whole gulden";
      if (d.amount < c.lending.min_amount) return `Amount must be at least ${fl(c.lending.min_amount)}`;
      const h = state.houses.find((x) => x.id === d.house);
      if (!h) return `Unknown house "${d.house}"`;
      const terms = lendingTerms(state, h, tuning);
      if (terms.refused) return terms.refused;
      if (d.amount > terms.room) return `${h.name} will lend at most ${fl(terms.room)} (all houses together, no more than ${fl(c.lending.max_outstanding)})`;
      return null;
    }
    case "pay_slowly":
    case "suspend":
      if (state.withdrawal_policy !== "normal") return "Depositors' payouts are already limited this quarter";
      return null;
    case "call_loan": {
      const loan = state.loans.find((l) => l.id === d.loan);
      if (!loan) return `Unknown loan #${d.loan}`;
      if (loan.status !== "active") return `Loan #${loan.id} is not active`;
      return null;
    }
  }
}

/** Applies a crisis response. Returns a new state; the input is not changed. */
export function applyCrisis(state: GameState, d: CrisisDecision, data: GameData): DecisionResult {
  const reason = checkCrisis(state, d, data.tuning);
  if (reason) return { ok: false, reason };
  const c = data.tuning.crisis;
  const next = cloneState(state);
  useCapacity(next, d.kind, data.tuning);
  const loseReputation = (n: number) => (next.house.reputation = Math.max(0, next.house.reputation - n));

  switch (d.kind) {
    case "borrow": {
      const terms = lendingTerms(next, next.houses.find((x) => x.id === d.house)!, data.tuning);
      const debt: Debt = {
        id: next.debts.length + 1,
        lender: terms.house.name,
        house: terms.house.id,
        principal: d.amount,
        rate: terms.rate,
        start_turn: next.world.turn,
        term_quarters: c.lending.term_quarters,
        status: "active",
      };
      next.debts.push(debt);
      next.house.cash += d.amount;
      const note = `Debt #${debt.id}: borrowed from ${debt.lender} at ${(debt.rate * 100).toFixed(1)}%`;
      addEntry(next, "cash", "borrowing", d.amount, note);
      addEntry(next, "borrowings", "borrowing", d.amount, note);
      loseReputation(c.lending.reputation_cost);
      break;
    }
    case "pay_slowly":
      next.withdrawal_policy = "slow";
      loseReputation(c.pay_slowly.reputation_cost);
      break;
    case "suspend":
      next.withdrawal_policy = "suspended";
      loseReputation(c.suspend.reputation_cost);
      // Closing the doors embarrasses the whole bourse.
      for (const h of next.houses) changeOpinion(next, h.id, -c.suspend.opinion_cost, data.tuning);
      break;
    case "call_loan": {
      const loan = next.loans.find((l) => l.id === d.loan)!;
      const recovered = callRecovery(loan.principal, data.tuning);
      loan.status = "called";
      next.house.cash += recovered;
      const note = `Loan #${loan.id}: called in from ${loan.borrower_name}, ${fl(loan.principal - recovered)} forgiven`;
      addEntry(next, "cash", "loan_called", recovered, note);
      addEntry(next, "loans", "loan_called", -loan.principal, note);
      const b = next.borrowers.find((x) => x.id === loan.borrower_id);
      if (b) b.away_until = next.world.turn + c.call_loan.absence_quarters;
      break;
    }
  }
  return { ok: true, state: next };
}

/**
 * Pays this quarter's interest on every active debt and repays any that reach their term, from
 * cash and then forced sales. If even selling everything cannot pay, the house goes bankrupt.
 * Mutates `state`; callers pass a draft copy.
 */
export function serviceDebts(state: GameState, tuning: Tuning): void {
  for (const debt of state.debts) {
    if (debt.status !== "active" || state.house.status === "bankrupt") continue;
    const due = state.world.turn - debt.start_turn + 1 >= debt.term_quarters;
    const interest = debtInterest(debt);
    const total = interest + (due ? debt.principal : 0);
    if (state.house.cash < total) raiseCash(state, total - Math.max(0, state.house.cash), tuning, `to pay ${debt.lender}`);
    if (state.house.cash < total) {
      state.house.status = "bankrupt";
      return;
    }
    state.house.cash -= interest;
    addEntry(state, "cash", "debt_interest", -interest, `Debt #${debt.id}: interest to ${debt.lender}`);
    if (due) {
      state.house.cash -= debt.principal;
      debt.status = "repaid";
      const note = `Debt #${debt.id}: repaid to ${debt.lender}`;
      addEntry(state, "cash", "debt_repayment", -debt.principal, note);
      addEntry(state, "borrowings", "debt_repayment", -debt.principal, note);
      changeOpinion(state, debt.house, tuning.crisis.lending.repaid_opinion, tuning);
    }
  }
}
