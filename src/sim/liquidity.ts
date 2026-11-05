import { bondValue } from "./bonds";
import { addEntry } from "./ledger";
import { payWithdrawal } from "./reserves";
import { applyWithdrawals } from "./sentiment";
import type { Tuning } from "./tuning";
import type { Bond, GameState } from "./types";

/** Smallest amount (capped at `available`) whose sale at `ratio` per gulden fetches at least `needed`. */
export function amountToSell(needed: number, available: number, ratio: number): number {
  const fetch = (n: number) => Math.round(n * ratio);
  let slice = Math.min(available, Math.ceil(needed / ratio));
  while (slice > 1 && fetch(slice - 1) >= needed) slice--;
  while (slice < available && fetch(slice) < needed) slice++;
  return slice;
}

/** What a slice of loan principal fetches in a forced sale, in whole gulden. */
export function loanSalePrice(principal: number, tuning: Tuning): number {
  return Math.round(principal * (1 - tuning.forced_sale.loan_discount));
}

/** Smallest slice of principal (capped at the whole loan) whose sale price covers `needed`. */
export function principalToSell(needed: number, available: number, tuning: Tuning): number {
  return amountToSell(needed, available, 1 - tuning.forced_sale.loan_discount);
}

/** Forced-sale price per gulden of face value: the last market price less the bond discount. */
export function bondSaleRatio(bond: Pick<Bond, "price">, tuning: Tuning): number {
  return bond.price * (1 - tuning.forced_sale.bond_discount);
}

/** What a slice of a venture's stake fetches in a forced sale, in whole gulden. */
export function ventureSalePrice(amount: number, tuning: Tuning): number {
  return Math.round(amount * (1 - tuning.forced_sale.venture_discount));
}

/**
 * Sells assets at a discount until `needed` cash is raised or nothing is left to sell.
 * Order: bonds (most liquid, oldest first), then loans (oldest first), then ventures (oldest
 * first, steepest discount). Only the slice needed is sold: the rest stays on the books and keeps
 * earning. A holding sold down to nothing gets status `sold`. Returns the cash raised.
 * Mutates `state`; callers pass a draft copy.
 */
export function raiseCash(state: GameState, needed: number, tuning: Tuning): number {
  let raised = 0;
  for (const bond of state.bonds) {
    if (raised >= needed) break;
    if (bond.status !== "active") continue;
    const ratio = bondSaleRatio(bond, tuning);
    const face = amountToSell(needed - raised, bond.face_value, ratio);
    const proceeds = Math.round(face * ratio);
    const bookBefore = bondValue(bond);
    bond.face_value -= face;
    if (bond.face_value === 0) bond.status = "sold";
    state.house.cash += proceeds;
    raised += proceeds;
    const what = bond.status === "sold" ? "sold" : `${face} of face value sold, ${bond.face_value} kept`;
    const note = `Bond #${bond.id} (${bond.issuer_state}) ${what}, at a discount to meet withdrawals`;
    addEntry(state, "cash", "forced_sale", proceeds, note);
    addEntry(state, "bonds", "forced_sale", -(bookBefore - bondValue(bond)), note);
  }
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
  for (const v of state.ventures) {
    if (raised >= needed) break;
    if (v.status !== "active") continue;
    const slice = amountToSell(needed - raised, v.invested, 1 - tuning.forced_sale.venture_discount);
    const price = ventureSalePrice(slice, tuning);
    v.invested -= slice;
    if (v.invested === 0) v.status = "sold";
    state.house.cash += price;
    raised += price;
    const what = v.status === "sold" ? "sold" : `${slice} of the stake sold, ${v.invested} kept`;
    const note = `Venture #${v.id} (${v.type}) ${what}, at a discount to meet withdrawals`;
    addEntry(state, "cash", "forced_sale", price, note);
    addEntry(state, "ventures", "forced_sale", -slice, note);
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
