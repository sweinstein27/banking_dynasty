import type { GameState, LedgerAccount, LedgerCategory } from "./types";

/** Appends a ledger entry. Mutates `state`; callers pass a draft copy. */
export function addEntry(
  state: GameState,
  account: LedgerAccount,
  category: LedgerCategory,
  amount: number,
  note: string,
): void {
  state.ledger.push({
    id: state.next_id++,
    turn: state.world.turn,
    account,
    category,
    amount,
    note,
  });
}

/** Sum of all entries for one account. Should equal that balance at any point. */
export function accountBalance(state: GameState, account: LedgerAccount): number {
  return state.ledger.filter((e) => e.account === account).reduce((sum, e) => sum + e.amount, 0);
}
