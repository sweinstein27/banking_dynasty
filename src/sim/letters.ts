// Letters: events that ask for an answer. A letter arrives with its event at the end of a quarter
// and is answered during the next one. A response's certain effects apply the moment it is chosen,
// so they show in the preview; anything that draws on the RNG (its chance, a random heir, a loan
// picked at random, a follow-up's timing) is settled when that quarter ends.
import { checkActionLeft, type DecisionResult } from "./actions";
import { applyEffectList, isUncertain, optionCost } from "./events";
import { fl } from "./format";
import { freeCash } from "./reserves";
import type { Rng } from "./rng";
import { cloneState } from "./state";
import type { EventOption, GameData, GameEvent } from "./tuning";
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
  const over = checkActionLeft({ ...state, actions_this_turn: 0 }, data.tuning);
  if (over) return over;
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
