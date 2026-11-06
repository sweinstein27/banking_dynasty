// Helpers shared by every scripted strategy.
import { applyDecision } from "../sim/decisions";
import { optionCost } from "../sim/events";
import { checkAnswerLetter } from "../sim/letters";
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

/**
 * How a strategy answers letters. "safe" takes the costliest response it can afford (in every
 * letter that is the paid, certain one); "risky" takes the first free response that carries a
 * chance. When neither applies, the strategy leaves the letter and the sim takes its default.
 */
export type LetterStyle = "safe" | "risky";

/** One maker per letter on the desk, answering in `style`. Put them first: replies use no action, and paid ones need the cash. */
export function letterReplies(state: GameState, data: GameData, style: LetterStyle): ((s: GameState) => Decision | null)[] {
  return state.letters.map((letter) => (s: GameState): Decision | null => {
    const options = data.events.find((e) => e.id === letter.event)?.options ?? [];
    const open = options.filter((o) => !checkAnswerLetter(s, { kind: "answer_letter", event: letter.event, option: o.id }, data));
    const pick =
      style === "safe"
        ? [...open].sort((a, b) => optionCost(b) - optionCost(a))[0]
        : open.find((o) => o.chance && optionCost(o) === 0);
    return pick && (style === "risky" || optionCost(pick) > 0) ? { kind: "answer_letter", event: letter.event, option: pick.id } : null;
  });
}
