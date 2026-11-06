// Letters: events that ask for an answer. A letter arrives with its event at the end of a quarter
// and is answered during the next one. A response's certain effects apply the moment it is chosen,
// so they show in the preview; anything that draws on the RNG (its chance, a random heir, a loan
// picked at random, a follow-up's timing) is settled when that quarter ends.
import { runOver, type DecisionResult } from "./actions";
import { applyEffectList, isUncertain, optionCost } from "./events";
import { fl } from "./format";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import { cloneState } from "./state";
import { traitById } from "./traits";
import type { EventEffect, EventOption, GameData, GameEvent } from "./tuning";
import type { AnswerLetterDecision, GameState, Letter } from "./types";

/** Certain effects never draw; this stands in for the RNG so a mistake fails loudly. */
const NO_RNG: Rng = {
  next: () => {
    throw new Error("A certain effect drew on the RNG");
  },
};

/** The event behind a letter and the response it names, if both exist. */
export function letterOption(letter: Pick<Letter, "event">, optionId: string, data: GameData): { event: GameEvent; option: EventOption } | null {
  const event = data.events.find((e) => e.id === letter.event);
  const option = event?.options?.find((o) => o.id === optionId);
  return event && option ? { event, option } : null;
}

/** Letters still waiting for an answer. */
export function unansweredLetters(state: GameState): Letter[] {
  return state.letters.filter((l) => l.answer === null);
}

/** Returns why a response can't be chosen, or null if it can. Uses no action, so a full desk is no bar. */
export function checkAnswerLetter(state: GameState, d: AnswerLetterDecision, data: GameData): string | null {
  const over = runOver(state, data.tuning);
  if (over) return over === "bankrupt" ? "The house is bankrupt" : "The run is over";
  const letter = state.letters.find((l) => l.event === d.event);
  if (!letter) return `No letter from "${d.event}" awaits an answer`;
  if (letter.answer !== null) return "That letter has already been answered";
  const found = letterOption(letter, d.option, data);
  if (!found) return `No response "${d.option}" to that letter`;
  const cost = optionCost(found.option);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (cost ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Answers a letter: its certain effects apply now. Returns a new state; the input is not changed. */
export function answerLetter(state: GameState, d: AnswerLetterDecision, data: GameData): DecisionResult {
  const reason = checkAnswerLetter(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const letter = next.letters.find((l) => l.event === d.event)!;
  const { event, option } = letterOption(letter, d.option, data)!;
  applyEffectList(next, option.effects.filter((e) => !isUncertain(e)), `Letter: ${event.title}`, NO_RNG, data);
  letter.answer = option.id;
  return { ok: true, state: next };
}

/**
 * Settles every letter at End Turn, in arrival order. An unanswered letter takes its event's
 * default response, certain effects included. Then the response's uncertain effects apply, and its
 * chance, if any, is rolled (one roll). Records each outcome and clears the desk. Mutates `state`.
 */
export function settleLetters(state: GameState, rng: Rng, data: GameData): void {
  for (const letter of state.letters) {
    const event = data.events.find((e) => e.id === letter.event);
    const byDefault = letter.answer === null;
    const found = event && letterOption(letter, letter.answer ?? event.default_option ?? "", data);
    if (!found) continue;
    const { option } = found;
    const note = `Letter: ${found.event.title}`;
    if (byDefault) applyEffectList(state, option.effects.filter((e) => !isUncertain(e)), note, NO_RNG, data);
    applyEffectList(state, option.effects.filter(isUncertain), note, rng, data);
    let chance: boolean | null = null;
    if (option.chance) {
      chance = rng.next() < option.chance.p;
      if (chance) applyEffectList(state, option.chance.effects, note, rng, data);
    }
    state.letter_outcomes.push({ turn: state.world.turn, event: letter.event, option: option.id, by_default: byDefault, chance });
  }
  state.letters = [];
}

const SMALL = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A probability in plain words: "an even chance", "one chance in three", "about seven chances in ten". */
export function oddsWords(p: number): string {
  if (Math.abs(p - 0.5) < 0.01) return "an even chance";
  for (let n = 2; n <= 10; n++) {
    if (Math.abs(p - 1 / n) < 0.01) return `one chance in ${SMALL[n]}`;
    if (n > 2 && Math.abs(p - (n - 1) / n) < 0.01) return `${SMALL[n - 1]} chances in ${SMALL[n]}`;
  }
  const tenths = Math.min(9, Math.max(1, Math.round(p * 10)));
  return `about ${SMALL[tenths]} ${tenths === 1 ? "chance" : "chances"} in ten`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** One effect in plain words, for response cards and the terminal. Fixed costs are left to optionCost. */
export function describeEffect(e: EventEffect, data: GameData): string | null {
  switch (e.kind) {
    case "cash":
      if (e.amount !== undefined) return e.amount < 0 ? null : `brings in ${fl(e.amount)}`;
      return `${(e.share ?? 0) < 0 ? "loses" : "gains"} ${Math.round(Math.abs(e.share ?? 0) * 100)}% of cash`;
    case "reputation":
      return `reputation ${signed(e.delta)}`;
    case "heir_talent":
      return `a child gains ${e.gain} in a stat, picked at random`;
    case "heir_trait":
      return `a child is left ${(traitById(e.trait, data)?.name ?? e.trait).toLowerCase()}`;
    case "follow_up": {
      const ev = data.events.find((x) => x.id === e.event);
      const what = ev ? ev.effects.map((x) => describeEffect(x, data)).filter(Boolean).join(", ") : "";
      const when = e.within_quarters === 4 ? "within a year" : `within ${e.within_quarters} quarters`;
      const house = ev?.conditions.house_opinion && data.houses.houses.find((h) => h.id === ev.conditions.house_opinion!.house);
      const unless = house ? `, if ${house.name} is still trading` : "";
      return `${when}: ${ev?.title ?? "more trouble"}${what ? ` (${what})` : ""}${unless}`;
    }
    case "loan_default":
      return "a loan picked at random defaults";
    case "opinion": {
      const name = data.houses.houses.find((h) => h.id === e.house)?.name ?? e.house;
      return `${name}'s opinion of you ${signed(e.delta)}`;
    }
    case "state_risk": {
      const name = data.states.find((s) => s.id === e.state)?.name ?? e.state;
      return `${name} bonds ${e.delta > 0 ? "riskier" : "safer"}`;
    }
    case "trade_risk":
      return `merchant loans ${e.factor > 1 ? "riskier" : "safer"}`;
    case "set_sentiment":
      return `the market turns ${e.sentiment}`;
    case "panic_warning":
      return `a panic in ${e.quarters} quarters`;
  }
}

/** A response card's lines: what it costs, what it does for certain, and its odds, all in words. */
export function describeOption(o: EventOption, data: GameData): { cost: number; effects: string[]; odds: string | null } {
  const effects = o.effects.map((e) => describeEffect(e, data)).filter((x): x is string => !!x);
  const odds = o.chance
    ? `${oddsWords(o.chance.p)}: ${o.chance.effects.map((e) => describeEffect(e, data)).filter(Boolean).join(", ") || "nothing more"}`
    : null;
  return { cost: optionCost(o), effects, odds };
}
