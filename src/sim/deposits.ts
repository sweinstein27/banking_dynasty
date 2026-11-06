// Deposits that follow reputation: a respected house draws depositors' money in calm times, and
// pays them a little interest on everything they keep with it.
import { addEntry } from "./ledger";
import type { Tuning } from "./tuning";
import type { GameState } from "./types";

/** The deposits a house's reputation would draw if it had time: per_reputation fl. for each point. */
export function depositLevel(reputation: number, tuning: Tuning): number {
  return Math.round(reputation * tuning.deposits.per_reputation);
}

/** This quarter's interest on deposits, in whole gulden: deposits x annual rate / 4. */
export function depositInterest(deposits: number, tuning: Tuning): number {
  return Math.round((deposits * tuning.deposits.interest_rate) / 4);
}

/** New deposits this quarter: in a calm market, catch_up of the gap below the reputation's level; otherwise none. */
export function depositInflow(state: GameState, tuning: Tuning): number {
  if (state.world.sentiment !== "calm") return 0;
  const gap = depositLevel(state.house.reputation, tuning) - state.house.deposits;
  return gap > 0 ? Math.round(gap * tuning.deposits.catch_up) : 0;
}

/**
 * The quarter's deposit flows, after withdrawals: interest is credited to depositors' accounts (what
 * the house owes rises; no cash moves), then in a calm market new depositors bring cash toward the
 * level the house's reputation draws. A bankrupt house has neither. Mutates `state`; callers pass a draft copy.
 */
export function resolveDeposits(state: GameState, tuning: Tuning): void {
  const { house } = state;
  if (house.status === "bankrupt") return;
  const interest = depositInterest(house.deposits, tuning);
  if (interest > 0) {
    house.deposits += interest;
    addEntry(state, "deposits", "deposit_interest", interest, "Interest credited to depositors");
  }
  const inflow = depositInflow(state, tuning);
  if (inflow > 0) {
    house.cash += inflow;
    house.deposits += inflow;
    const note = `New deposits, drawn by the house's reputation (${house.reputation})`;
    addEntry(state, "cash", "deposit_inflow", inflow, note);
    addEntry(state, "deposits", "deposit_inflow", inflow, note);
  }
}
