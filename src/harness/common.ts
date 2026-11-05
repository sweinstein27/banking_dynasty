// Helpers shared by every scripted strategy.
import { applyDecision } from "../sim/decisions";
import { lendOffers, type LendOffer } from "../sim/offers";
import { freeCash } from "../sim/reserves";
import type { GameData } from "../sim/tuning";
import type { Decision, GameState } from "../sim/types";

/** A scripted player: given the state at the start of a turn, the decisions it queues. */
export type Strategy = (state: GameState, data: GameData) => Decision[];

/** `share` of free cash, rounded down to 100 fl. */
export const shareOfFree = (s: GameState, f: number) => Math.floor((freeCash(s) * f) / 100) * 100;

/** Lends `share` of free cash (to the nearest 100 fl., capped at what was asked) to a request at its maximum rate. */
export function lendShare(s: GameState, o: LendOffer, share: number): Decision {
  return { kind: "lend", borrower: o.borrower_id, amount: Math.min(o.amount, shareOfFree(s, share)), rate: o.max_rate };
}

/**
 * Tries the decisions a strategy wants, in order, each made from the state the earlier ones left,
 * keeping those the sim accepts. A maker may return null to skip. Stops at nothing: the sim itself
 * refuses decisions beyond the turn's actions.
 */
export function accepted(state: GameState, data: GameData, wanted: ((s: GameState) => Decision | null)[]): Decision[] {
  const decisions: Decision[] = [];
  let preview = state;
  for (const make of wanted) {
    const d = make(preview);
    if (!d) continue;
    const r = applyDecision(preview, d, data);
    if (!r.ok) continue;
    decisions.push(d);
    preview = r.state;
  }
  return decisions;
}

/** This quarter's requests, safest-looking first (highest estimate low bound, then borrower id). */
export const safestFirst = (s: GameState, data: GameData) =>
  [...lendOffers(s, data)].sort((a, b) => b.estimate.low - a.estimate.low || a.borrower_id - b.borrower_id);
