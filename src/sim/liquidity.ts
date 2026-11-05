import { addEntry } from "./ledger";
import { payWithdrawal } from "./reserves";
import { applyWithdrawals } from "./sentiment";
import type { Tuning } from "./tuning";
import type { GameState } from "./types";

/** What a slice of loan principal fetches in a forced sale, in whole gulden. */
export function loanSalePrice(principal: number, tuning: Tuning): number {
  return Math.round(principal * (1 - tuning.forced_sale.loan_discount));
}

/** Smallest slice of principal (capped at the whole loan) whose sale price covers `needed`. */
export function principalToSell(needed: number, available: number, tuning: Tuning): number {
  let slice = Math.min(available, Math.ceil(needed / (1 - tuning.forced_sale.loan_discount)));
  while (slice > 1 && loanSalePrice(slice - 1, tuning) >= needed) slice--;
  while (slice < available && loanSalePrice(slice, tuning) < needed) slice++;
  return slice;
}

/**
 * Sells assets at a discount until `needed` cash is raised or nothing is left to sell.
 * Loans go oldest first, and only the slice of principal needed is sold: the rest stays on the
 * books and keeps earning. A loan sold down to nothing gets status `sold`.
 * Bonds and ventures join this list in later steps. Returns the cash raised.
 * Mutates `state`; callers pass a draft copy.
 */
export function raiseCash(state: GameState, needed: number, tuning: Tuning): number {
  let raised = 0;
  for (const loan of state.loans) {
    if (raised >= needed) break;
    if (loan.status !== "active") continue;
    const slice = principalToSell(needed - raised, loan.principal, tuning);
    const price = loanSalePrice(slice, tuning);
    loan.principal -= slice;
    if (loan.principal === 0) loan.status = "sold";
    state.house.cash += price;
    raised += price;
    const what = loan.status === "sold" ? "sold" : `${slice} of principal sold, ${loan.principal} kept`;
    const note = `Loan #${loan.id} (${loan.borrower_name}) ${what}, at a discount to meet withdrawals`;
    addEntry(state, "cash", "forced_sale", price, note);
    addEntry(state, "loans", "forced_sale", -slice, note);
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
