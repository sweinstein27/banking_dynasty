import { payWithdrawal, type WithdrawalResult } from "./reserves";
import type { Rng } from "./rng";
import type { Tuning } from "./tuning";
import type { GameState, Sentiment } from "./types";

/**
 * Starts a countdown to a panic: the market turns (or stays) uneasy for `quarters` quarters, then
 * panics. Does nothing if a countdown is running or the market already panics. Mutates `state`.
 */
export function startPanicWarning(state: GameState, quarters: number): void {
  if (state.panic_warning || state.world.sentiment === "panic") return;
  state.panic_warning = { turns_left: Math.max(1, Math.round(quarters)) };
  state.world.sentiment = "uneasy";
}

/**
 * Next quarter's mood with panic warnings applied, given the mood roll's result. A running
 * countdown keeps the market uneasy and ends in a panic, whatever the roll. A roll that would start
 * a panic instead starts a countdown of panic_warning_quarters (one more roll). Mutates `state`.
 */
export function moodWithWarnings(state: GameState, rolled: Sentiment, rng: Rng, tuning: Tuning): Sentiment {
  const warning = state.panic_warning;
  if (warning) {
    warning.turns_left -= 1;
    if (warning.turns_left > 0) return "uneasy";
    state.panic_warning = null;
    return "panic";
  }
  if (rolled === "panic" && state.world.sentiment !== "panic") {
    const { min, max } = tuning.sentiment.panic_warning_quarters;
    startPanicWarning(state, min + Math.floor(rng.next() * (max - min + 1)));
    return "uneasy";
  }
  return rolled;
}

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

/**
 * Deposits withdrawn this quarter given the mood and the house's reputation, in whole gulden.
 * The mood's share is scaled by 1 + weight * (neutral - reputation) / neutral: a house below the
 * neutral reputation loses more, one above it loses less.
 */
export function withdrawalDemand(deposits: number, sentiment: Sentiment, tuning: Tuning, reputation: number): number {
  const { neutral, weight } = tuning.sentiment.reputation_withdrawals;
  const scale = Math.max(0, 1 + (weight * (neutral - reputation)) / neutral);
  return Math.min(deposits, Math.round(deposits * tuning.sentiment.withdrawal_share[sentiment] * scale));
}

/**
 * Depositors withdraw their share for the current mood, paying what cash allows.
 * Any shortfall is handled by resolveWithdrawals in liquidity.ts. Mutates `state`; callers pass a draft copy.
 */
export function applyWithdrawals(state: GameState, tuning: Tuning): WithdrawalResult | null {
  const { sentiment } = state.world;
  const asked = withdrawalDemand(state.house.deposits, sentiment, tuning, state.house.reputation);
  const policy = state.withdrawal_policy;
  // Paying slowly pays a share now; a suspension pays nothing. Either way the deposits stay owed.
  const demand = policy === "suspended" ? 0 : policy === "slow" ? Math.round(asked * tuning.crisis.pay_slowly.share) : asked;
  if (demand === 0) return null;
  const how = policy === "slow" ? ", paid slowly" : "";
  return payWithdrawal(state, demand, `Depositors withdraw (${sentiment}${how})`);
}
