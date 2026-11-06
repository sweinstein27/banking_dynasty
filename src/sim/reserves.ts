import { cloneState } from "./state";
import { fl } from "./format";
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { addEntry } from "./ledger";
import type { Tuning } from "./tuning";
import type { GameState, SetReserveDecision } from "./types";

/** Cash the house may spend: anything above the reserve floor. */
export function freeCash(state: GameState): number {
  return Math.max(0, state.house.cash - state.house.reserve);
}

/** Returns why a set_reserve decision is invalid, or null if it can go ahead. */
export function checkSetReserve(state: GameState, d: SetReserveDecision, tuning: Tuning): string | null {
  const noAction = checkCapacity(state, "set_reserve", tuning);
  if (noAction) return noAction;
  if (!Number.isInteger(d.amount)) return "Reserve must be whole gulden";
  if (d.amount < 0) return "Reserve cannot be negative";
  if (d.amount === state.house.reserve) return `Reserve is already ${fl(d.amount)}`;
  return null;
}

/**
 * Sets the cash floor. No money moves, so no ledger entry is written.
 * A reserve above current cash is allowed: it simply blocks new spending until cash catches up.
 */
export function setReserve(state: GameState, d: SetReserveDecision, tuning: Tuning): DecisionResult {
  const reason = checkSetReserve(state, d, tuning);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  next.house.reserve = d.amount;
  useCapacity(next, "set_reserve", tuning);
  return { ok: true, state: next };
}

export interface WithdrawalResult {
  /** Paid out of the reserve. */
  fromReserve: number;
  /** Paid out of cash above the reserve. */
  fromFreeCash: number;
  /** Demanded but not paid because cash ran out. */
  shortfall: number;
}

/**
 * Pays depositors who withdraw `amount`, drawing on the reserve first, then on free cash.
 * Pays what cash allows and reports the rest as a shortfall (forced sales handle it later).
 * The reserve floor itself is left unchanged, so new spending stays blocked until cash is rebuilt.
 * Mutates `state`; callers pass a draft copy.
 */
export function payWithdrawal(state: GameState, amount: number, note: string): WithdrawalResult {
  const { house } = state;
  const demanded = Math.min(Math.max(0, amount), house.deposits);
  const paid = Math.min(demanded, Math.max(0, house.cash));
  const fromReserve = Math.min(paid, Math.max(0, Math.min(house.reserve, house.cash)));
  const result = { fromReserve, fromFreeCash: paid - fromReserve, shortfall: demanded - paid };
  if (paid === 0) return result;

  house.cash -= paid;
  house.deposits -= paid;
  const detail = `${note} (${fromReserve} from reserve, ${result.fromFreeCash} from free cash)`;
  addEntry(state, "cash", "withdrawal", -paid, detail);
  addEntry(state, "deposits", "withdrawal", -paid, detail);
  return result;
}
