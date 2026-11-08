import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { poolFor } from "../src/sim/capacity";
import { applyDecision } from "../src/sim/decisions";
import { checkEventData } from "../src/sim/events";
import { headOf, succeed } from "../src/sim/family";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import {
  applyLetterOutcomes,
  checkPoliticsData,
  contractFavour,
  contractGateRelief,
  createPolitics,
  eligibleMembers,
  growInfluence,
  influence,
  offices,
  openCourtRequests,
  politicsBook,
  politicsOptionEffects,
  postLetters,
  resolvePolitics,
  winChance,
  withdrawalRelief,
  type PoliticsData,
} from "../src/sim/systems/politics";
import { netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { Decision, GameState } from "../src/sim/types";
import { fresh, quiet } from "./helpers";

const P = gameData.politics;
const C = P.courts;
const senate = P.offices.find((o) => o.id === "senate")!;
const diet = P.offices.find((o) => o.id === "diet")!;

/** Quiet test data with politics tuned by the test: no vacancies and no court requests unless asked. */
function data(over: Partial<PoliticsData> = {}): GameData {
  const base: PoliticsData = {
    ...P,
    offices: P.offices.map((o) => ({ ...o, vacancy_chance: 0 })),
    courts: { ...C, request_chance: 0, default_chance: 0, delay_chance: { calm: 0, uneasy: 0, panic: 0 } },
  };
  return { ...quiet, politics: { ...base, ...over } };
}
const D = data();
/** Offices that always fall vacant, and candidates who always win (or always lose). */
const officesWith = (chance: number, win: number) =>
  P.offices.map((o) => ({ ...o, vacancy_chance: chance, win: { ...o.win, base: win, per_reputation: 0, per_influence: 0, per_opinion: 0, min: win, max: win } }));
const NO_RNG = { next: () => 0.5 };

/** A house in 1830 Q1: Johann (65) heads it; Friedrich 27, Amalie 24, Carl 20. */
function house(): GameState {
  const s = fresh();
  s.world.year = 1830;
  s.world.quarter = 1;
  return s;
}
const johann = (s: GameState) => headOf(s)!.id;
const byName = (s: GameState, first: string) => s.people.find((p) => p.name.startsWith(first))!.id;

function ok(s: GameState, d: Decision, gd: GameData = D): GameState {
  const r = applyDecision(s, d, gd);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
function refused(s: GameState, d: Decision, gd: GameData = D): string {
  const r = applyDecision(s, d, gd);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}
/** A house with a Senate seat held by Johann since the start. */
function senator(): GameState {
  const s = house();
  s.politics.seats.push({ office: "senate", person: johann(s), since_turn: 0 });
  return s;
}
const ledgerMatches = (s: GameState) => expect(accountBalance(s, "court_loans")).toBe(politicsBook(s));

describe("politics data", () => {
  it("is sound, and so are its letters", () => {
    expect(checkPoliticsData(gameData)).toEqual([]);
    expect(checkEventData(gameData)).toEqual([]);
  });

  it("catches a letter that is not a follow-up, an unknown court and a default that lends", () => {
    const events = gameData.events.map((e) => (e.id === "politics-hep-hep" ? { ...e, follow_up: false, weight: 1 } : e));
    const letters = P.letters.map((l) =>
      l.event === "politics-imperial-loan" ? { ...l, responses: [{ option: "refuse", court_loan: { court: "atlantis", amount: 1, rate: 0.05, term_quarters: 4 } }] } : l,
    );
    const problems = checkPoliticsData({ ...gameData, events, politics: { ...P, letters } });
    expect(problems).toContain("politics-hep-hep: must be marked follow_up so it never fires by date or weight");
    expect(problems).toContain('politics-imperial-loan: unknown court "atlantis"');
    expect(problems).toContain("politics-imperial-loan: the default response cannot lend");
  });

  it("puts the head's own business on the head's time and court loans with the clerks", () => {
    for (const k of ["stand_for_office", "cultivate_influence", "seek_court", "senate_assurance"] as const) expect(poolFor(k)).toBe("head");
    expect(poolFor("lend_court")).toBe("deals");
  });
});

describe("a new game", () => {
  it("starts with no office, no influence, and draws nothing from the run's RNG", () => {
    const rng = createRng(42);
    const before = rng.state;
    const p = createPolitics(gameData, rng);
    expect(rng.state).toBe(before);
    expect(p.influence).toBe(0);
    expect(offices(house())).toEqual({ senate: null, diet: null, courts: [] });
    expect(politicsBook(house())).toBe(0);
  });

  it("changes nothing in other systems through its hooks without office or influence", () => {
    const s = house();
    expect(contractFavour(s, "austria", gameData)).toBe(0);
    expect(contractGateRelief(s, "austria", gameData)).toBe(0);
    expect(withdrawalRelief(s, gameData)).toBe(1);
  });
});

describe("seats", () => {
  it("open no Senate vacancy before 1817, then one when the roll falls", () => {
    const gd = data({ offices: officesWith(1, 1) });
    const early = house();
    early.world.year = 1816;
    early.world.quarter = 2;
    resolvePolitics(early, NO_RNG, gd);
    expect(early.politics.vacancies).toEqual([]);
    const s = house();
    resolvePolitics(s, NO_RNG, gd);
    expect(s.politics.vacancies).toEqual([{ office: "senate", turn: s.world.turn + 1, candidate: null }]);
    expect(s.news.at(-1)!.title).toBe("A vacancy in the Senate");
  });

  it("open the Diet only to a house with a senator", () => {
    const gd = data({ offices: officesWith(1, 1) });
    const s = senator();
    resolvePolitics(s, NO_RNG, gd);
    expect(s.politics.vacancies.map((v) => v.office)).toEqual(["diet"]);
  });

  it("take men of the line aged 30 or more", () => {
    const s = house();
    s.politics.vacancies.push({ office: "senate", turn: s.world.turn, candidate: null });
    expect(eligibleMembers(s, "senate", D).map((p) => p.id)).toEqual([johann(s)]);
    expect(refused(s, { kind: "stand_for_office", office: "senate", member: byName(s, "Friedrich") })).toBe("Friedrich Adler must be 30 or older");
    expect(refused(s, { kind: "stand_for_office", office: "senate", member: byName(s, "Amalie") })).toBe("Only men could sit in the Senate");
  });

  it("need an open vacancy, the house's standing, the citizen's property and the cash", () => {
    const s = house();
    const stand: Decision = { kind: "stand_for_office", office: "senate", member: johann(s) };
    expect(refused(s, stand)).toBe("No place in the Senate is vacant this quarter");
    s.politics.vacancies.push({ office: "senate", turn: s.world.turn, candidate: null });
    s.house.reputation = senate.min_reputation - 1;
    expect(refused(s, stand)).toMatch(/takes only a house of reputation 45/);
    s.house.reputation = 60;
    const poor = structuredClone(s);
    poor.house.cash = 4000;
    poor.house.reserve = 0;
    poor.house.deposits = 0;
    poor.loans = [];
    expect(netWorth(poor)).toBeLessThan(senate.min_net_worth);
    expect(refused(poor, stand)).toBe("A citizen must hold 5,000 fl. in property to stand");
    const noCash = structuredClone(s);
    noCash.house.reserve = noCash.house.cash;
    expect(refused(noCash, stand)).toMatch(/^Not enough cash above the reserve/);
  });

  it("charge for standing, use the head's time, and settle with one roll", () => {
    const won = data({ offices: officesWith(0, 1) });
    const s0 = house();
    s0.politics.vacancies.push({ office: "senate", turn: s0.world.turn, candidate: null });
    const s = ok(s0, { kind: "stand_for_office", office: "senate", member: johann(s0) }, won);
    expect(s.house.cash).toBe(s0.house.cash - senate.cost);
    expect(s.counting.used.head).toBe(1);
    expect(refused(s, { kind: "stand_for_office", office: "senate", member: johann(s) }, won)).toBe("The house already has a candidate for the Senate");

    const win = structuredClone(s);
    resolvePolitics(win, NO_RNG, won);
    expect(offices(win).senate).toBe(johann(s));
    expect(win.house.reputation).toBe(s.house.reputation + senate.win_reputation);
    expect(win.politics.influence).toBe(senate.influence_per_quarter);
    expect(win.politics.vacancies).toEqual([]);

    const lose = structuredClone(s);
    resolvePolitics(lose, NO_RNG, data({ offices: officesWith(0, 0) }));
    expect(offices(lose).senate).toBeNull();
    expect(lose.news.at(-1)!.title).toBe("Passed over for the Senate");
  });

  it("lapse when the holder dies, the Diet with the Senate, and influence falls", () => {
    const s = senator();
    s.politics.seats.push({ office: "diet", person: johann(s), since_turn: 0 });
    s.politics.influence = 40;
    succeed(s, quiet);
    resolvePolitics(s, NO_RNG, D);
    expect(s.politics.seats).toEqual([]);
    // 40 less 10 for each lost seat, then the quarter's decay.
    expect(s.politics.influence).toBe(Math.floor(20 * (1 - P.influence.decay)));
  });

  it("lapse for a candidate who dies before the result", () => {
    const won = data({ offices: officesWith(0, 1) });
    const s = house();
    s.politics.vacancies.push({ office: "senate", turn: s.world.turn, candidate: johann(s) });
    succeed(s, quiet);
    resolvePolitics(s, NO_RNG, won);
    expect(s.politics.seats).toEqual([]);
  });

  it("end the Diet post when the Diet hands its powers to the Regent in 1848", () => {
    const s = senator();
    s.politics.seats.push({ office: "diet", person: johann(s), since_turn: 0 });
    s.world.year = 1848;
    s.world.quarter = 1;
    resolvePolitics(s, NO_RNG, D);
    expect(offices(s).diet).toBe(johann(s));
    s.world.quarter = 2;
    resolvePolitics(s, NO_RNG, D);
    expect(offices(s).diet).toBeNull();
    expect(offices(s).senate).toBe(johann(s));
    expect(diet.until).toEqual({ year: 1848, quarter: 3 });
  });

  it("give better odds to a house of standing and influence, within limits", () => {
    const s = house();
    s.house.reputation = 50;
    s.politics.influence = 0;
    expect(winChance(s, "senate", D)).toBe(0.25);
    s.politics.influence = 30;
    s.house.reputation = 70;
    expect(winChance(s, "senate", D)).toBe(0.65);
    s.politics.influence = 100;
    expect(winChance(s, "senate", D)).toBe(senate.win.max);
  });
});

describe("influence", () => {
  it("decays, rounded down, and the offices add to it", () => {
    const s = senator();
    s.politics.influence = 50;
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    growInfluence(s, D);
    expect(s.politics.influence).toBe(Math.floor(50 * 0.92) + 3 + 2);
  });

  it("can be bought with dinners and favours, up to its height", () => {
    const s = ok(house(), { kind: "cultivate_influence" });
    expect(influence(s)).toBe(P.influence.cultivate.gain);
    expect(s.ledger.at(-1)!.category).toBe("political_gift");
    const top = house();
    top.politics.influence = P.influence.max;
    expect(refused(top, { kind: "cultivate_influence" })).toBe("The house's influence is already at its height");
  });
});

describe("courts", () => {
  /** A house of standing that may seek any court. */
  function standing(): GameState {
    const s = house();
    s.house.reputation = 80;
    s.politics.influence = 40;
    return s;
  }

  it("take a house of standing for a gift, at most two", () => {
    const s0 = standing();
    const s1 = ok(s0, { kind: "seek_court", court: "nassau" });
    expect(s1.house.cash).toBe(s0.house.cash - 2000);
    expect(s1.politics.courts).toEqual([{ court: "nassau", since_turn: s0.world.turn, favour: C.favour.start }]);
    expect(refused(s1, { kind: "seek_court", court: "nassau" })).toBe("The house is already banker to the court of Nassau");
    s1.counting.used.head = 0;
    const s2 = ok(s1, { kind: "seek_court", court: "austria" });
    s2.counting.used.head = 0;
    expect(refused(s2, { kind: "seek_court", court: "prussia" })).toBe("A house can serve at most 2 courts");
    const low = house();
    expect(refused(low, { kind: "seek_court", court: "austria" })).toMatch(/takes only a house of reputation 60/);
  });

  it("ask for loans, which pay interest and come back at term", () => {
    const gd = data({ courts: { ...D.politics.courts, request_chance: 1 } });
    const s = standing();
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    resolvePolitics(s, NO_RNG, gd);
    expect(s.politics.requests).toHaveLength(1);
    s.world.turn += 1;
    const r = openCourtRequests(s)[0]!;
    expect(r.amount % C.amount_step).toBe(0);
    expect(r.amount).toBeGreaterThanOrEqual(5000);
    const worth = netWorth(s);
    const lent = ok(s, { kind: "lend_court", request: r.id });
    expect(netWorth(lent)).toBe(worth);
    expect(politicsBook(lent)).toBe(r.amount);
    expect(lent.politics.courts[0]!.favour).toBe(20 + C.favour.accept);
    ledgerMatches(lent);

    const loan = lent.politics.loans[0]!;
    lent.world.turn = loan.due_turn;
    const cash = lent.house.cash;
    resolvePolitics(lent, NO_RNG, D);
    expect(lent.politics.loans[0]!.status).toBe("repaid");
    expect(lent.house.cash).toBe(cash + Math.round((r.amount * C.rate) / 4) + r.amount);
    ledgerMatches(lent);
  });

  it("put off repayment, or default, on a roll", () => {
    const s = standing();
    s.politics.loans.push({ id: 1, court: "hesse", principal: 10000, rate: 0.05, start_turn: 0, due_turn: s.world.turn, status: "active" });
    const delayed = structuredClone(s);
    resolvePolitics(delayed, NO_RNG, data({ courts: { ...D.politics.courts, delay_chance: { calm: 1, uneasy: 1, panic: 1 } } }));
    expect(delayed.politics.loans[0]).toMatchObject({ status: "active", due_turn: s.world.turn + C.delay_quarters });
    const lost = structuredClone(s);
    lost.ledger.push({ id: 9999, turn: 0, account: "court_loans", category: "court_loan", amount: 10000, note: "test" });
    resolvePolitics(lost, NO_RNG, data({ courts: { ...D.politics.courts, default_chance: 1 } }));
    expect(lost.politics.loans[0]!.status).toBe("defaulted");
    ledgerMatches(lost);
  });

  it("dismiss a house that refuses once too often, and will not take it back", () => {
    const s = standing();
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    s.politics.requests.push({ id: 1, court: "nassau", amount: 5000, rate: 0.05, term_quarters: 8, turn: s.world.turn, accepted: false });
    resolvePolitics(s, NO_RNG, D);
    expect(s.politics.courts).toEqual([]);
    expect(s.politics.dismissed).toEqual(["nassau"]);
    expect(refused(s, { kind: "seek_court", court: "nassau" })).toMatch(/will not take it back/);
  });

  it("refuse a loan the house cannot cover", () => {
    const s = standing();
    s.politics.requests.push({ id: 1, court: "nassau", amount: 5000, rate: 0.05, term_quarters: 8, turn: s.world.turn, accepted: false });
    s.house.reserve = s.house.cash;
    expect(refused(s, { kind: "lend_court", request: 1 })).toMatch(/^Not enough cash above the reserve/);
  });

  it("favour their own banker in their state's loan contracts", () => {
    const s = standing();
    s.politics.influence = 50;
    s.politics.courts.push({ court: "austria", since_turn: 0, favour: 20 });
    expect(contractFavour(s, "austria", gameData)).toBe(0.01);
    expect(contractFavour(s, "prussia", gameData)).toBe(0.005);
    expect(contractGateRelief(s, "austria", gameData)).toBe(15);
    expect(contractGateRelief(s, "prussia", gameData)).toBe(5);
  });

  it("add reputation at year end", () => {
    const s = standing();
    s.world.quarter = 4;
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    const rep = s.house.reputation;
    resolvePolitics(s, NO_RNG, D);
    expect(s.house.reputation).toBe(rep + 1);
  });
});

describe("the Senate's assurance", () => {
  it("needs a senator, an anxious market and the influence, and eases this quarter's withdrawals", () => {
    const s = senator();
    s.politics.influence = 30;
    expect(refused(s, { kind: "senate_assurance" })).toBe("The Senate's assurance is only for an uneasy or panicking market");
    s.world.sentiment = "panic";
    expect(refused(house(), { kind: "senate_assurance" })).toBe("Only a house with a seat in the Senate can give the city's assurance");
    const low = structuredClone(s);
    low.politics.influence = 10;
    expect(refused(low, { kind: "senate_assurance" })).toMatch(/needs influence of 20/);
    const done = ok(s, { kind: "senate_assurance" });
    expect(done.politics.influence).toBe(10);
    expect(withdrawalRelief(done, gameData)).toBe(0.5);
    done.counting.used.head = 0;
    expect(refused(done, { kind: "senate_assurance" })).toBe("The assurance has already been given this quarter");
    done.world.turn += 1;
    expect(withdrawalRelief(done, gameData)).toBe(1);
  });
});

describe("letters", () => {
  const withLetters: GameData = { ...D, events: gameData.events };

  it("go to every house, or only to a senator, in the quarter they describe", () => {
    const s = house();
    s.world.year = 1819;
    s.world.quarter = 2;
    postLetters(s, withLetters);
    expect(s.letters.map((l) => l.event)).toEqual(["politics-hep-hep"]);
    s.world.quarter = 3;
    postLetters(s, withLetters);
    expect(s.letters.map((l) => l.event)).toEqual(["politics-hep-hep"]);
    const sen = senator();
    sen.world.year = 1819;
    sen.world.quarter = 3;
    postLetters(sen, withLetters);
    expect(sen.letters.map((l) => l.event)).toEqual(["politics-carlsbad"]);
    expect(sen.fired_events.at(-1)!.id).toBe("politics-carlsbad");
    postLetters(sen, withLetters);
    expect(sen.letters).toHaveLength(1);
  });

  it("apply their politics effects once, after the letter settles", () => {
    const s = house();
    s.politics.influence = 30;
    s.letter_outcomes.push({ turn: s.world.turn, event: "politics-imperial-loan", option: "lend", by_default: false, chance: null });
    applyLetterOutcomes(s, withLetters);
    expect(s.politics.influence).toBe(38);
    expect(politicsBook(s)).toBe(20000);
    expect(s.politics.loans[0]).toMatchObject({ court: "austria", rate: 0.06 });
    ledgerMatches(s);
    applyLetterOutcomes(s, withLetters);
    expect(politicsBook(s)).toBe(20000);
  });

  it("make no loan, and give no favour, when the cash is not there", () => {
    const s = house();
    s.house.cash = 1000;
    s.letter_outcomes.push({ turn: s.world.turn, event: "politics-imperial-loan", option: "lend", by_default: false, chance: null });
    applyLetterOutcomes(s, withLetters);
    expect(politicsBook(s)).toBe(0);
    expect(s.politics.influence).toBe(0);
    expect(s.news.at(-1)!.title).toBe("A loan that could not be made");
  });

  it("describe their politics effects in words", () => {
    expect(politicsOptionEffects("politics-imperial-loan", "lend", gameData)).toEqual(["influence +8", "lends 20,000 fl. to the imperial court at Vienna at 6% for 8 quarters"]);
    expect(politicsOptionEffects("politics-hep-hep", "aloof", gameData)).toEqual([]);
  });
});

describe("bankruptcy and saves", () => {
  it("strip every office from a bankrupt house", () => {
    const s = senator();
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    s.house.status = "bankrupt";
    resolvePolitics(s, NO_RNG, D);
    expect(offices(s)).toEqual({ senate: null, diet: null, courts: [] });
  });

  it("keep court loans in a save that loads", () => {
    const s = house();
    s.house.reputation = 80;
    s.politics.courts.push({ court: "nassau", since_turn: 0, favour: 20 });
    s.politics.requests.push({ id: 1, court: "nassau", amount: 5000, rate: 0.05, term_quarters: 8, turn: s.world.turn, accepted: false });
    const lent = ok(s, { kind: "lend_court", request: 1 });
    const r = parseSave(toSave(lent, 1, 1, []), D);
    expect(r.ok).toBe(true);
  });
});
