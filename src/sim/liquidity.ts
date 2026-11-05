import { addEntry } from "./ledger";
import { payWithdrawal } from "./reserves";
import { applyWithdrawals } from "./sentiment";
import type { Tuning } from "./tuning";
import type { GameState } from "./types";

/** What a loan fetches in a forced sale, in whole gulden. */
export function loanSalePrice(principal: number, tuning: Tuning): number {
  return Math.round(principal * (1 - tuning.forced_sale.loan_discount));
}

/**
 * Sells whole assets at a discount until `needed` cash is raised or nothing is left to sell.
 * Loans go oldest first. Bonds and ventures join this list in later steps.
 * Returns the cash raised, which can exceed `needed` because assets are sold whole.
 * Mutates `state`; callers pass a draft copy.
 */
export function raiseCash(state: GameState, needed: number, tuning: Tuning): number {
  let raised = 0;
  for (const loan of state.loans) {
    if (raised >= needed) break;
    if (loan.status !== "active") continue;
    const price = loanSalePrice(loan.principal, tuning);
    loan.status = "sold";
    state.house.cash += price;
    raised += price;
    const note = `Loan #${loan.id} (${loan.borrower_name}) sold at a discount to meet withdrawals`;
    addEntry(state, "cash", "forced_sale", price, note);
    addEntry(state, "loans", "forced_sale", -loan.principal, note);
  }
  return raised;
}

export interface WithdrawalOutcome {
  demanded: number;
  /** Cash raised by forced sales. */
  raised: number;
  bankrupt: boolean;
}

/**
 * Pays this quarter's withdrawals: cash first (reserve before free cash), then forced sales.
 * If selling everything still cannot pay depositors, the house goes bankrupt and the run ends.
 * Mutates `state`; callers pass a draft copy.
 */
export function resolveWithdrawals(state: GameState, tuning: Tuning): WithdrawalOutcome {
  const first = applyWithdrawals(state, tuning);
  if (!first) return { demanded: 0, raised: 0, bankrupt: false };
  const demanded = first.fromReserve + first.fromFreeCash + first.shortfall;
  if (first.shortfall === 0) return { demanded, raised: 0, bankrupt: false };

  const raised = raiseCash(state, first.shortfall, tuning);
  const second = payWithdrawal(state, first.shortfall, "Depositors paid from forced sales");
  const bankrupt = second.shortfall > 0;
  if (bankrupt) state.house.status = "bankrupt";
  return { demanded, raised, bankrupt };
}
