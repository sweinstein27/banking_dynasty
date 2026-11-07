import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecisions } from "../src/sim/decisions";
import { checkEventData, conditionsMet, optionCost } from "../src/sim/events";
import { heirTrait } from "../src/sim/family";
import { accountBalance } from "../src/sim/ledger";
import { answerLetter, describeOption, oddsWords, settleLetters, unansweredLetters } from "../src/sim/letters";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import type { GameData, GameEvent } from "../src/sim/tuning";
import { endTurn } from "../src/sim/turn";
import type { AnswerLetterDecision, GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const CALM = 0.999999;

/** A clerk's theft: a letter with a paid, a risky and a delayed response. */
const clerk: GameEvent = {
  id: "clerk",
  title: "A clerk",
  text: "A clerk has been skimming.",
  historical: false,
  weight: 1,
  conditions: {},
  effects: [{ kind: "cash", share: -0.01 }],
  options: [
    { id: "prosecute", label: "Prosecute", text: "He is tried.", effects: [{ kind: "cash", amount: -500 }, { kind: "reputation", delta: 2 }] },
    { id: "quiet", label: "Dismiss him quietly", text: "He goes quietly.", effects: [], chance: { p: 1 / 3, effects: [{ kind: "reputation", delta: -6 }], text: "Word gets out.", miss_text: "Nobody hears of it." } },
    { id: "forgive", label: "Forgive him", text: "He is forgiven.", effects: [{ kind: "reputation", delta: -1 }, { kind: "follow_up", event: "again", within_quarters: 4 }] },
  ],
  default_option: "quiet",
};
const again: GameEvent = { id: "again", title: "Again", text: "He steals again.", historical: false, follow_up: true, conditions: {}, effects: [{ kind: "cash", amount: -100 }] };
const data: GameData = { ...quiet, events: [clerk, again] };

const answer = (option: string): AnswerLetterDecision => ({ kind: "answer_letter", event: "clerk", option });

/** A fresh house with the clerk's letter on the desk, as if it arrived at the end of the last turn. */
function withLetter(): GameState {
  const s = fresh();
  s.letters = [{ event: "clerk", turn: 0, answer: null }];
  return s;
}

function decide(s: GameState, ...ds: AnswerLetterDecision[]): GameState {
  const r = applyDecisions(s, ds, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function refusal(s: GameState, d: AnswerLetterDecision): string {
  const r = answerLetter(s, d, data);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

describe("letter data", () => {
  const check = (ev: Partial<GameEvent>, extra: GameEvent[] = [again]) => checkEventData({ ...data, events: [{ ...clerk, ...ev }, ...extra] });

  it("accepts the test letter", () => {
    expect(check({})).toEqual([]);
  });

  it("refuses too few responses, a bad default, and a default that costs money", () => {
    expect(check({ options: clerk.options!.slice(0, 1) })).toContain("clerk: options need 2 to 3 responses");
    expect(check({ default_option: "nobody" })).toContain("clerk: default_option must name one of the options");
    expect(check({ default_option: "prosecute" })).toContain("clerk: the default option must cost nothing");
  });

  it("refuses bad odds, unknown traits, dashes, and follow-ups that are not marked", () => {
    const opts = clerk.options!;
    expect(check({ options: [opts[0]!, { ...opts[1]!, chance: { ...opts[1]!.chance!, p: 1 } }] })).toContain("clerk: option quiet: chance p must be between 0 and 1");
    expect(check({ options: [opts[0]!, { ...opts[1]!, effects: [{ kind: "heir_trait", trait: "nosy" }] }] })).toContain('clerk: option quiet: unknown trait "nosy"');
    expect(check({ options: [{ ...opts[0]!, text: "He is tried — badly." }, opts[1]!] })).toContain("clerk: option prosecute: uses a dash; the writing style forbids em dashes");
    expect(check({}, [{ ...again, follow_up: false, weight: 1 }])).toContain('clerk: follow_up event "again" must be marked follow_up');
    expect(check({}, [])).toContain('clerk: follow_up names unknown event "again"');
    expect(check({}, [{ ...again, weight: 2 }])).toContain("again: follow-up events take no date and no weight");
  });

  it("counts only fixed cash losses as a response's cost", () => {
    expect(clerk.options!.map(optionCost)).toEqual([500, 0, 0]);
  });

  it("the real event file is sound", () => {
    expect(checkEventData(gameData)).toEqual([]);
  });
});

describe("a letter arrives", () => {
  it("with its event, at the end of the turn, and the news says it awaits an answer", () => {
    // Rolls: mood, the random-event roll (0: fires), the pick.
    const s1 = endTurn(fresh(), [], fixedRng(CALM, 0, 0, CALM), data);
    expect(s1.letters).toEqual([{ event: "clerk", turn: 1, answer: null }]);
    expect(s1.news.find((n) => n.kind === "event")!.text).toBe("A clerk has been skimming. A letter awaits your answer.");
    // The event's own effect has already happened.
    expect(accountBalance(s1, "cash")).toBe(s1.house.cash);
    expect(s1.house.cash).toBeLessThan(fresh().house.cash);
  });

  it("follow-up events never fire at random", () => {
    const s1 = endTurn(fresh(), [], fixedRng(CALM, 0, 0.999, CALM), { ...data, events: [again, { ...clerk, weight: 1 }] });
    expect(s1.fired_events.map((f) => f.id)).toEqual(["clerk"]);
  });
});

describe("answering", () => {
  it("applies the certain effects at once, writes the ledger, and uses no action", () => {
    const s0 = withLetter();
    const s1 = decide(s0, answer("prosecute"));
    expect(s1.house.cash).toBe(s0.house.cash - 500);
    expect(s1.house.reputation).toBe(s0.house.reputation + 2);
    expect(s1.ledger.at(-1)).toMatchObject({ account: "cash", category: "event", amount: -500, note: "Letter: A clerk" });
    expect(s1.letters[0]!.answer).toBe("prosecute");
    expect(s1.actions_this_turn).toBe(0);
    expect(unansweredLetters(s1)).toEqual([]);
    expect(s0.letters[0]!.answer).toBeNull();
  });

  it("is allowed with the quarter's actions used up", () => {
    const s = withLetter();
    s.counting.used = { deals: 99, reports: 99, opinions: 99, head: 99 };
    expect(answerLetter(s, answer("quiet"), data).ok).toBe(true);
  });

  it("refuses a response the house can't afford, with the reason", () => {
    const s = withLetter();
    s.house.reserve = s.house.cash - 499;
    expect(refusal(s, answer("prosecute"))).toMatch(/^Not enough cash above the reserve \(cost 500\sfl\., free 499\sfl\.\)$/);
    // The default costs nothing, so it is always open.
    expect(answerLetter(s, answer("quiet"), data).ok).toBe(true);
  });

  it("refuses a second answer, a missing letter and an unknown response", () => {
    const s = decide(withLetter(), answer("quiet"));
    expect(refusal(s, answer("forgive"))).toBe("That letter has already been answered");
    expect(refusal(fresh(), answer("quiet"))).toBe('No letter from "clerk" awaits an answer');
    expect(refusal(withLetter(), answer("bribe"))).toBe('No response "bribe" to that letter');
  });

  it("leaves uncertain effects for End Turn", () => {
    const s0 = withLetter();
    const s1 = decide(s0, answer("forgive"));
    expect(s1.house.reputation).toBe(s0.house.reputation - 1);
    expect(s1.scheduled_events).toEqual([]);
  });
});

describe("settling at End Turn", () => {
  it("an answered letter's chance comes up below p and not above it", () => {
    // The settle roll comes first: no loans, so nothing draws before it.
    const hit = endTurn(decide(withLetter(), answer("quiet")), [], fixedRng(0.3, CALM, CALM), data);
    const miss = endTurn(decide(withLetter(), answer("quiet")), [], fixedRng(0.34, CALM, CALM), data);
    expect(hit.house.reputation).toBe(fresh().house.reputation - 6);
    expect(miss.house.reputation).toBe(fresh().house.reputation);
    expect(hit.letter_outcomes).toEqual([{ turn: 1, event: "clerk", option: "quiet", by_default: false, chance: true }]);
    expect(miss.letter_outcomes[0]!.chance).toBe(false);
    expect(hit.news.find((n) => n.kind === "letter")).toEqual({ turn: 1, kind: "letter", title: "A clerk", text: "He goes quietly. Word gets out." });
    expect(miss.news.find((n) => n.kind === "letter")!.text).toBe("He goes quietly. Nobody hears of it.");
    expect(hit.letters).toEqual([]);
  });

  it("over many quarters the chance comes up about as often as it says", () => {
    const rng = createRng(7);
    let hits = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const s = decide(withLetter(), answer("quiet"));
      settleLetters(s, rng, data);
      if (s.letter_outcomes.at(-1)!.chance) hits++;
    }
    expect(hits / n).toBeGreaterThan(1 / 3 - 0.02);
    expect(hits / n).toBeLessThan(1 / 3 + 0.02);
  });

  it("an unanswered letter takes the default response, and the news says so", () => {
    const s1 = endTurn(withLetter(), [], fixedRng(0.9, CALM, CALM), data);
    expect(s1.letter_outcomes).toEqual([{ turn: 1, event: "clerk", option: "quiet", by_default: true, chance: false }]);
    expect(s1.news.find((n) => n.kind === "letter")!.text).toBe("Left unanswered. He goes quietly. Nobody hears of it.");
    expect(s1.letters).toEqual([]);
  });

  it("a default's certain effects apply too", () => {
    const s = withLetter();
    const d: GameData = { ...data, events: [{ ...clerk, default_option: "forgive" }, again] };
    const s1 = endTurn(s, [], fixedRng(0, CALM, CALM), d);
    expect(s1.house.reputation).toBe(s.house.reputation - 1);
    expect(s1.scheduled_events).toEqual([{ id: "again", turn: 2 }]);
  });

  it("a follow-up fires at the quarter it was scheduled for, within the window", () => {
    // Roll 0.6 for the follow-up's timing: 1 + floor(0.6 * 4) = 3 turns on, so turn 4.
    let s = endTurn(decide(withLetter(), answer("forgive")), [], fixedRng(0.6, CALM, CALM), data);
    expect(s.scheduled_events).toEqual([{ id: "again", turn: 4 }]);
    const cash = s.house.cash;
    s = endTurn(s, [], fixedRng(CALM), data);
    s = endTurn(s, [], fixedRng(CALM), data);
    expect(s.fired_events).toEqual([]);
    s = endTurn(s, [], fixedRng(CALM), data);
    expect(s.fired_events).toEqual([{ id: "again", turn: 4 }]);
    expect(s.house.cash).toBe(cash - 100);
    expect(s.scheduled_events).toEqual([]);
    expect(s.news.at(-1)).toMatchObject({ kind: "event", title: "Again" });
  });

  it("the books reconcile after every kind of response", () => {
    for (const option of ["prosecute", "quiet", "forgive"]) {
      const s = endTurn(decide(withLetter(), answer(option)), [], fixedRng(0, CALM, CALM), data);
      expect(accountBalance(s, "cash"), option).toBe(s.house.cash);
    }
  });
});

describe("heir_trait", () => {
  const sickly = (s: GameState) => s.people.filter((p) => p.traits.includes("sickly")).map((p) => p.name);

  it("gives the trait to a random heir who could still gain it", () => {
    const s = fresh();
    const heirs = s.people.filter((p) => !p.is_head);
    heirs[0]!.traits = ["hale"];
    heirTrait(s, "sickly", fixedRng(0), gameData);
    expect(sickly(s)).toEqual([heirs[1]!.name]);
  });

  it("does nothing, and draws nothing, when no heir can gain it", () => {
    const s = fresh();
    for (const p of s.people) if (!p.is_head) p.traits = ["hale"];
    let draws = 0;
    heirTrait(s, "sickly", { next: () => (draws++, 0) }, gameData);
    expect(sickly(s)).toEqual([]);
    expect(draws).toBe(0);
  });

  it("is settled at End Turn when it comes with a response", () => {
    const fever: GameEvent = {
      ...clerk,
      id: "fever",
      options: [
        { id: "doctors", label: "Doctors", text: "Doctors come.", effects: [{ kind: "cash", amount: -500 }] },
        { id: "local", label: "Local", text: "The local man.", effects: [], chance: { p: 0.5, effects: [{ kind: "heir_trait", trait: "sickly" }], text: "The child is left sickly." } },
      ],
      default_option: "local",
    };
    const d: GameData = { ...quiet, events: [fever] };
    const s0 = fresh();
    s0.letters = [{ event: "fever", turn: 0, answer: null }];
    const r = applyDecisions(s0, [{ kind: "answer_letter", event: "fever", option: "local" }], d);
    if (!r.ok) throw new Error(r.reason);
    expect(sickly(r.state)).toEqual([]);
    // Rolls: the chance (0: comes up), then the heir.
    const s1 = endTurn(r.state, [], fixedRng(0, 0, CALM, CALM), d);
    expect(sickly(s1)).toHaveLength(1);
    // Told plainly, not as a coming of age.
    expect(s1.news.some((n) => n.kind === "family" && n.text.startsWith(`${sickly(s1)[0]} is left sickly.`))).toBe(true);
  });
});

describe("saves", () => {
  it("keep letters, outcomes and follow-ups, and replay a queued answer", () => {
    const s = withLetter();
    s.scheduled_events = [{ id: "again", turn: 3 }];
    const r = parseSave(toSave(s, 1, 1, [answer("prosecute")]), data);
    if (!r.ok) throw new Error(r.reason);
    expect(r.save.state.letters).toEqual(s.letters);
    expect(r.save.state.scheduled_events).toEqual(s.scheduled_events);
    expect(r.save.queued).toEqual([answer("prosecute")]);
  });

  it("refuse a save without letters", () => {
    const s = fresh() as Partial<GameState>;
    delete s.letters;
    const r = parseSave(toSave(s as GameState, 1, 1, []), data);
    expect(r.ok ? "" : r.reason).toBe('Save file state is missing "letters"');
  });
});

describe("default_within_quarters", () => {
  it("holds only when a borrower defaulted within that many quarters", () => {
    const s = fresh();
    s.world.turn = 10;
    const c = { default_within_quarters: 4 };
    const date = { year: 1818, quarter: 1 as const };
    expect(conditionsMet(s, c, date)).toBe(false);
    s.borrowers[0]!.last_default_turn = 7;
    expect(conditionsMet(s, c, date)).toBe(true);
    s.borrowers[0]!.last_default_turn = 6;
    expect(conditionsMet(s, c, date)).toBe(false);
  });
});

describe("response cards in words", () => {
  it("states odds in plain words", () => {
    expect([0.5, 0.333, 0.25, 0.1, 2 / 3, 0.7, 0.04].map(oddsWords)).toEqual([
      "an even chance", "one chance in three", "one chance in four", "one chance in ten", "two chances in three", "about seven chances in ten", "about one chance in ten",
    ]);
  });

  it("lists cost, certain effects and odds, with no hidden numbers", () => {
    const [prosecute, dismiss, forgive] = clerk.options!;
    expect(describeOption(prosecute!, data)).toEqual({ cost: 500, effects: ["reputation +2"], odds: null });
    expect(describeOption(dismiss!, data)).toEqual({ cost: 0, effects: [], odds: "one chance in three: reputation −6" });
    expect(describeOption(forgive!, data).effects).toEqual(["reputation \u22121", "within a year: Again"]);
  });

  it("every real response has something to say", () => {
    for (const ev of gameData.events) {
      for (const o of ev.options ?? []) {
        const d = describeOption(o, gameData);
        expect(d.cost > 0 || d.effects.length > 0 || d.odds !== null || o.id === ev.default_option, `${ev.id}/${o.id}`).toBe(true);
      }
    }
  });
});
