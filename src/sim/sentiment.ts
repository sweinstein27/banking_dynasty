import { payWithdrawal, type WithdrawalResult } from "./reserves";
import type { Tuning } from "./tuning";
import type { GameState, Sentiment } from "./types";

/**
 * Next quarter's mood from one roll in [0, 1). Walks the current mood's transitions in the order
 * tuning.json lists them; a roll past all of them keeps the mood. Stand-in until events drive
 * sentiment in Week 4.
 */
export function nextSentiment(current: Sentiment, roll: number, tuning: Tuning): Sentiment {
  let threshold = 0;
  for (const [to, chance] of Object.entries(tuning.sentiment.transitions[current])) {
    threshold += chance ?? 0;
    if (roll < threshold) return to as Sentiment;
  }
  return current;
}

/** Deposits withdrawn this quarter given the mood, in whole gulden. */
export function withdrawalDemand(deposits: number, sentiment: Sentiment, tuning: Tuning): number {
  return Math.round(deposits * tuning.sentiment.withdrawal_share[sentiment]);
}

/**
 * Depositors withdraw their share for the current mood, paying what cash allows.
 * Any shortfall is handled by resolveWithdrawals in liquidity.ts. Mutates `state`; callers pass a draft copy.
 */
export function applyWithdrawals(state: GameState, tuning: Tuning): WithdrawalResult | null {
  const { sentiment } = state.world;
  const demand = withdrawalDemand(state.house.deposits, sentiment, tuning);
  if (demand === 0) return null;
  return payWithdrawal(state, demand, `Depositors withdraw (${sentiment})`);
}
