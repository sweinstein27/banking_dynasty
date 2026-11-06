import { cloneState } from "./state";
import { acumenFactor, headEffects, headStat } from "./family";
import { fl } from "./format";
import type { DecisionResult } from "./actions";
import { checkCapacity, useCapacity } from "./capacity";
import { addEntry } from "./ledger";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import type { GameData, Tuning } from "./tuning";
import type { GameState, InvestVentureDecision, Sentiment, Venture } from "./types";

/** Ventures at cost: capital still locked up. */
export function ventureBook(state: GameState): number {
  return state.ventures.filter((v) => v.status === "active").reduce((sum, v) => sum + v.invested, 0);
}

/** Chance of failure at maturity: failure_risk * m_sentiment * the head's Acumen factor * their traits' factor, capped at 1. */
export function ventureFailureChance(failureRisk: number, sentiment: Sentiment, tuning: Tuning, acumen: number, traitFactor: number): number {
  return Math.min(1, failureRisk * tuning.sentiment_multiplier[sentiment] * acumenFactor(acumen, tuning) * traitFactor);
}

/** Cash returned on success, in whole gulden: the stake plus its expected return. */
export function venturePayout(v: Pick<Venture, "invested" | "expected_return">): number {
  return Math.round(v.invested * (1 + v.expected_return));
}

/** Quarters until a venture matures; 1 means it resolves at the end of this turn. */
export function quartersLeft(state: GameState, v: Pick<Venture, "start_turn" | "term_quarters">): number {
  return v.term_quarters - (state.world.turn - v.start_turn);
}

/** Returns why an invest_venture decision is invalid, or null if it can go ahead. */
export function checkInvestVenture(state: GameState, d: InvestVentureDecision, data: GameData): string | null {
  const t = data.tuning;
  const type = data.ventures.find((v) => v.id === d.venture);
  if (!type) return `Unknown venture "${d.venture}"`;
  const noAction = checkCapacity(state, "invest_venture", t);
  if (noAction) return noAction;
  if (state.world.year < type.unlock_year) return `${type.name} ventures cannot be backed before ${type.unlock_year}`;
  if (!Number.isInteger(d.amount)) return "Amount must be whole gulden";
  if (d.amount < t.ventures.min_amount) return `Amount must be at least ${fl(t.ventures.min_amount)}`;
  if (d.amount > freeCash(state)) return `Not enough cash above the reserve (free ${fl(freeCash(state))})`;
  return null;
}

/** Locks cash into a venture. Returns a new state; the input is not changed. */
export function investVenture(state: GameState, d: InvestVentureDecision, data: GameData): DecisionResult {
  const reason = checkInvestVenture(state, d, data);
  if (reason) return { ok: false, reason };
  const type = data.ventures.find((v) => v.id === d.venture)!;

  const next = cloneState(state);
  const venture: Venture = {
    id: next.ventures.length + 1,
    type: type.id,
    invested: d.amount,
    expected_return: type.expected_return,
    failure_risk: type.failure_risk,
    unlock_year: type.unlock_year,
    start_turn: next.world.turn,
    term_quarters: type.term_quarters,
    status: "active",
  };
  next.ventures.push(venture);
  next.house.cash -= d.amount;
  useCapacity(next, "invest_venture", data.tuning);
  const note = `Venture #${venture.id}: ${type.name}, ${type.term_quarters} quarters`;
  addEntry(next, "cash", "venture_in", -d.amount, note);
  addEntry(next, "ventures", "venture_in", d.amount, note);
  return { ok: true, state: next };
}

/**
 * Resolves ventures that reach their term this quarter: one roll each, in id order.
 * Failure loses the whole stake; success returns the stake plus its expected return.
 * Ventures not yet due draw no roll. Mutates `state`; callers pass a draft copy.
 */
export function resolveVentures(state: GameState, rng: Rng, data: GameData): void {
  for (const v of state.ventures) {
    if (v.status !== "active" || quartersLeft(state, v) > 1) continue;
    const name = data.ventures.find((t) => t.id === v.type)?.name ?? v.type;

    if (rng.next() < ventureFailureChance(v.failure_risk, state.world.sentiment, data.tuning, headStat(state, "acumen", data), headEffects(state, data).venture_failure)) {
      v.status = "failed";
      addEntry(state, "ventures", "venture_failure", -v.invested, `Venture #${v.id}: ${name} failed`);
      continue;
    }

    const payout = venturePayout(v);
    v.status = "paid_out";
    state.house.cash += payout;
    const note = `Venture #${v.id}: ${name} paid out`;
    addEntry(state, "cash", "venture_payout", payout, note);
    addEntry(state, "ventures", "venture_payout", -v.invested, note);
  }
}
