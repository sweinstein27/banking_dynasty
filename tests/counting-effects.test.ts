// What the counting house's facilities and staff change elsewhere, the analysts' opinions and the advisor council (A2).
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision, applyDecisions } from "../src/sim/decisions";
import { createHouses } from "../src/sim/houses";
import { matchMoney } from "../src/sim/marriages";
import { createRng } from "../src/sim/rng";
import {
  adviceError,
  advisors,
  analystAccuracy,
  analystOpinion,
  createCounting,
  houseTerms,
  paymentRecordQuarters,
  reportCostFactor,
  resolveCounting,
  tellerInflow,
  topicTrouble,
  traitOf,
  warehouseSpace,
  warningKnown,
  withdrawalFactor,
  type FacilityId,
  type Staff,
  type StaffRole,
} from "../src/sim/systems/counting";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, GOOD, noDefaults, POOR, quiet, reopenRequests } from "./helpers";

/** The quiet test data with the real counting house, advisors silenced. */
const data = { ...quiet, counting: { ...gameData.counting, advice: { ...gameData.counting.advice, enabled: false } } };
/** The same with the advisors writing. */
const council = { ...quiet, counting: gameData.counting };
const e = gameData.counting.effects;

function house(): GameState {
  const s = fresh();
  s.counting = createCounting(data, createRng(5));
  return s;
}

function withFacility(s: GameState, id: FacilityId): GameState {
  s.counting.facilities.push({ id, ready_turn: 0 });
  return s;
}

let nextId = 100;
function withStaff(s: GameState, role: StaffRole, extra: Partial<Staff> = {}): Staff {
  const m: Staff = { id: nextId++, role, name: "Test Person", skill: 5, trait: "sharp", hired_turn: 0, start_turn: 0, leaving: false, ...extra };
  s.counting.staff.push(m);
  return m;
}

function ok(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("the strongroom", () => {
  it("scales withdrawals in a panic only, and only once it is built", () => {
    const s = house();
    s.world.sentiment = "panic";
    expect(withdrawalFactor(s, data)).toBe(1);
    withFacility(s, "strongroom");
    expect(withdrawalFactor(s, data)).toBe(e.strongroom_panic_withdrawals);
    s.world.sentiment = "uneasy";
    expect(withdrawalFactor(s, data)).toBe(1);
  });

  it("makes a panic's run smaller at End Turn", () => {
    const withdrawn = (s: GameState) => -endTurn(s, [], noDefaults, data).ledger.filter((x) => x.account === "cash" && x.category === "withdrawal").reduce((sum, x) => sum + x.amount, 0);
    const plain = house();
    plain.world.sentiment = "panic";
    const guarded = withFacility(house(), "strongroom");
    guarded.world.sentiment = "panic";
    expect(withdrawn(plain)).toBeGreaterThan(0);
    expect(withdrawn(guarded)).toBe(Math.round(withdrawn(plain) * e.strongroom_panic_withdrawals));
  });
});

describe("tellers", () => {
  it("draw teller_catch_up of the deposit gap each, in a calm market only", () => {
    const s = house();
    s.house.reputation = 80;
    expect(tellerInflow(s, data)).toBe(0);
    withStaff(s, "teller");
    withStaff(s, "teller");
    const gap = 80 * gameData.tuning.deposits.per_reputation - s.house.deposits;
    expect(tellerInflow(s, data)).toBe(Math.round(gap * 2 * e.teller_catch_up));
    s.world.sentiment = "uneasy";
    expect(tellerInflow(s, data)).toBe(0);
  });

  it("write the inflow to the ledger at End Turn", () => {
    const s = house();
    s.house.reputation = 80;
    withStaff(s, "teller");
    const expected = tellerInflow(s, data);
    resolveCounting(s, fixedRng(0.5), data);
    const lines = s.ledger.filter((x) => x.note.includes("tellers"));
    expect(lines.map((x) => [x.account, x.amount])).toEqual([["cash", expected], ["deposits", expected]]);
  });

  it("do nothing before they start", () => {
    const s = house();
    s.house.reputation = 80;
    withStaff(s, "teller", { start_turn: 2 });
    expect(tellerInflow(s, data)).toBe(0);
  });
});

describe("a partner and reception rooms", () => {
  it("change the terms for courting and marriages", () => {
    const s = house();
    expect(houseTerms(s, data)).toEqual({ cost_factor: 1, court_opinion: 0, marriage_opinion: 0 });
    withStaff(s, "partner");
    expect(houseTerms(s, data)).toEqual({ cost_factor: e.partner_cost_factor, court_opinion: e.partner_court_opinion, marriage_opinion: 0 });
    withFacility(s, "reception_rooms");
    expect(houseTerms(s, data)).toEqual({ cost_factor: e.partner_cost_factor, court_opinion: e.partner_court_opinion + e.reception_court_opinion, marriage_opinion: e.reception_marriage_opinion });
  });

  it("make courting cheaper and warmer", () => {
    const s0 = house();
    s0.houses = createHouses(gameData);
    withStaff(s0, "partner");
    withFacility(s0, "reception_rooms");
    const h = s0.houses[0]!;
    const r = applyDecision(s0, { kind: "court_house", house: h.id }, data);
    if (!r.ok) throw new Error(r.reason);
    const court = gameData.tuning.houses.court;
    expect(r.state.house.cash).toBe(s0.house.cash - Math.round(court.cost * e.partner_cost_factor));
    expect(r.state.houses[0]!.opinion).toBe(h.opinion + court.opinion + e.partner_court_opinion + e.reception_court_opinion);
  });

  it("make marriages cheaper, and reception rooms win a match at less opinion", () => {
    const s = house();
    s.houses = createHouses(gameData);
    const m = gameData.tuning.family.marriage;
    expect(matchMoney(s, { with: "merchant", form: "in" }, data)).toBe(-m.merchant.cost);
    withStaff(s, "partner");
    expect(matchMoney(s, { with: "merchant", form: "in" }, data)).toBe(-Math.round(m.merchant.cost * e.partner_cost_factor));
    expect(matchMoney(s, { with: s.houses[0]!.id, form: "out" }, data)).toBe(-Math.round(m.out.dowry * e.partner_cost_factor));

    // A widowed head of age: the "in" terms need min_opinion.
    const member = s.people.find((p) => p.is_head)!;
    s.people.find((p) => p.id === member.spouse)!.death_year = 1814;
    const h = s.houses[0]!;
    h.opinion = m.in.min_opinion - 5;
    h.reputation = s.house.reputation;
    const d: Decision = { kind: "arrange_marriage", member: member.id, with: h.id, form: "in" };
    const refused = applyDecision(s, d, data);
    expect(refused.ok ? "" : refused.reason).toMatch(new RegExp(`needs ${m.in.min_opinion}\\)`));
    withFacility(s, "reception_rooms");
    expect(applyDecision(s, d, data).ok).toBe(true);
  });
});

describe("hooks for credit and markets", () => {
  it("correspondents after the first make reports cheaper, up to the max", () => {
    const s = house();
    expect(reportCostFactor(s, data)).toBe(1);
    withStaff(s, "correspondent");
    expect(reportCostFactor(s, data)).toBeCloseTo(1 - e.correspondent_report_discount);
    for (let i = 0; i < 6; i++) withStaff(s, "correspondent");
    expect(reportCostFactor(s, data)).toBeCloseTo(1 - e.correspondent_max_discount);
  });

  it("an archive keeps payment records longer; a warehouse gives storage", () => {
    const s = house();
    expect(paymentRecordQuarters(s, data)).toBe(e.record_quarters);
    expect(warehouseSpace(s, data)).toBe(0);
    withFacility(s, "archive");
    withFacility(s, "warehouse");
    expect(paymentRecordQuarters(s, data)).toBe(e.archive_record_quarters);
    expect(warehouseSpace(s, data)).toBe(e.warehouse_space);
  });
});

describe("the courier stable and panic warnings", () => {
  const TO_PANIC = 0.35;
  const uneasy = (courier: boolean) => {
    const s = house();
    s.world.sentiment = "uneasy";
    return courier ? withFacility(s, "courier_stable") : s;
  };
  const warnings = (s: GameState) => s.news.filter((n) => n.kind === "warning" && n.turn === s.world.turn - 1);

  it("without one, a warning reaches the house a quarter late", () => {
    // The quiet data: the counting house draws no candidates, so the first roll is the mood's.
    const s1 = endTurn(uneasy(false), [], fixedRng(TO_PANIC, 0, 0.5), quiet);
    expect(s1.panic_warning).not.toBeNull();
    expect(warnings(s1)).toEqual([]);
    expect(warningKnown(s1, data)).toBe(false);
    const s2 = endTurn(s1, [], fixedRng(0.5), quiet);
    expect(warnings(s2)).toHaveLength(1);
    expect(warningKnown(s2, data)).toBe(true);
  });

  it("with one, it arrives at once", () => {
    const s1 = endTurn(uneasy(true), [], fixedRng(TO_PANIC, 0, 0.5), quiet);
    expect(warnings(s1)).toHaveLength(1);
    expect(warningKnown(s1, data)).toBe(true);
  });
});

describe("analysts", () => {
  it("are right below their accuracy, and otherwise give one of the two wrong verdicts", () => {
    expect(analystOpinion("sound", 0.7, 0.69)).toBe("sound");
    expect(analystOpinion("sound", 0.7, 0.71)).toBe("doubtful");
    expect(analystOpinion("sound", 0.7, 0.99)).toBe("unsound");
    expect(analystOpinion("unsound", 0.7, 0.8)).toBe("sound");
  });

  it("grow more accurate with skill, and their trait moves it, within bounds", () => {
    const a = gameData.counting.analysts;
    const at = (skill: number, trait = "careful") => analystAccuracy({ skill, start_turn: 1, trait }, 1, data);
    expect(at(2)).toBeCloseTo(a.base_accuracy + 2 * a.per_skill);
    expect(at(6)).toBeGreaterThan(at(2));
    expect(at(10)).toBe(a.max_accuracy);
    expect(at(2, "muddled")).toBeCloseTo(at(2) - 0.1);
    expect(at(6, "sharp")).toBeCloseTo(at(6) + 0.1);
    expect(analystAccuracy({ skill: 0, start_turn: 1, trait: "muddled" }, 1, data)).toBe(a.min_accuracy);
  });

  it("are right about as often as their accuracy over many draws", () => {
    const rng = createRng(3);
    const n = 4000;
    let right = 0;
    for (let i = 0; i < n; i++) if (analystOpinion("doubtful", 0.75, rng.next()) === "doubtful") right++;
    expect(right / n).toBeGreaterThan(0.72);
    expect(right / n).toBeLessThan(0.78);
  });

  it("write opinions from draws rolled at the End Turn before, two per analyst, cleared the quarter after", () => {
    let s = house();
    expect(applyDecision(s, { kind: "consult_analyst", borrower: GOOD }, data).ok).toBe(false);
    s = ok(s, { kind: "hire", role: "analyst", candidate: 0 });
    s = endTurn(s, [], noDefaults, data);
    reopenRequests(s);
    expect(s.counting.opinion_draws).toHaveLength(gameData.tuning.capacity.per_analyst);
    const a = ok(s, { kind: "consult_analyst", borrower: GOOD });
    const b = ok(s, { kind: "consult_analyst", borrower: GOOD });
    // The same quarter gives the same opinion: nothing is re-rolled.
    expect(a.counting.opinions).toEqual(b.counting.opinions);
    const op = a.counting.opinions[0]!;
    expect(op).toMatchObject({ turn: s.world.turn, borrower: GOOD, analyst: s.counting.staff.at(-1)!.id });
    expect(op.correct).toBe(op.verdict === "sound");
    const twice = applyDecision(a, { kind: "consult_analyst", borrower: GOOD }, data);
    expect(twice.ok ? "" : twice.reason).toMatch(/already written/);
    const full = ok(a, { kind: "consult_analyst", borrower: POOR });
    const third = applyDecision(full, { kind: "consult_analyst", borrower: 2 }, data);
    expect(third.ok ? "" : third.reason).toMatch(/No analyst is free/);
    const after = endTurn(full, [], noDefaults, data);
    expect(after.counting.opinions).toEqual([]);
  });

  it("only write on a borrower asking for a loan this quarter", () => {
    let s = ok(house(), { kind: "hire", role: "analyst", candidate: 0 });
    s = endTurn(s, [], noDefaults, data);
    const r = applyDecision(s, { kind: "consult_analyst", borrower: GOOD }, data);
    expect(r.ok ? "" : r.reason).toMatch(/not asking for a loan/);
  });
});

describe("the advisor council", () => {
  it("is the longest serving clerk, the longest serving correspondent and the head's spouse", () => {
    const s = house();
    const c = advisors(s, data);
    expect(c.chief_clerk).toMatchObject({ name: "Matthias Ebert", topic: "liquidity", trait: traitOf("careful", data) });
    expect(c.head_correspondent).toMatchObject({ name: "Simon Leclerc", topic: "market" });
    const head = s.people.find((p) => p.is_head)!;
    expect(c.spouse).toMatchObject({ name: s.people.find((p) => p.id === head.spouse)!.name, topic: "family" });
    s.counting.staff = [];
    s.people.find((p) => p.id === head.spouse)!.death_year = 1815;
    expect(advisors(s, data)).toEqual({});
  });

  it("err less with skill, and their traits tilt them toward alarm or calm", () => {
    const cfg = gameData.counting.advice;
    const base = cfg.base_error - 5 * cfg.per_skill;
    expect(adviceError({ skill: 5, trait: undefined }, true, data)).toBeCloseTo(base);
    expect(adviceError({ skill: 5, trait: traitOf("careful", data) }, false, data)).toBeCloseTo(base * 1.5);
    expect(adviceError({ skill: 5, trait: traitOf("careful", data) }, true, data)).toBeCloseTo(base * 0.5);
    expect(adviceError({ skill: 5, trait: traitOf("sanguine", data) }, true, data)).toBeCloseTo(base * 1.5);
    expect(adviceError({ skill: 99, trait: undefined }, true, data)).toBe(cfg.min_error);
  });

  it("read their topics from the books", () => {
    const s = house();
    expect(topicTrouble(s, "liquidity", data)).toBe(false);
    s.house.cash = 1000;
    expect(topicTrouble(s, "liquidity", data)).toBe(true);
    expect(topicTrouble(s, "market", data)).toBe(false);
    s.panic_warning = { turns_left: 2 };
    expect(topicTrouble(s, "market", data)).toBe(true);
    // In 1815 the children are young: the heir is not ready.
    expect(topicTrouble(s, "family", data)).toBe(true);
  });

  it("all write before the routine quarter, as letters in the news", () => {
    const s = house();
    s.world.quarter = 4;
    resolveCounting(s, fixedRng(0.99), council);
    expect(s.counting.advice.map((a) => [a.advisor, a.alarm, a.correct])).toEqual([
      ["chief_clerk", false, true],
      ["head_correspondent", false, true],
      ["spouse", true, true],
    ]);
    const letters = s.news.filter((n) => n.kind === "letter");
    expect(letters.map((n) => n.title)).toEqual(["From the chief clerk, Matthias Ebert", "From the head correspondent, Simon Leclerc", expect.stringMatching(/^From the head's spouse, /)]);
    expect(letters[2]!.text).toMatch(/is not yet ready to lead the house/);
    expect(letters.every((n) => !/[—–]/.test(n.text))).toBe(true);
  });

  it("otherwise write only to warn, then wait out the cooldown", () => {
    const s = house();
    s.world.quarter = 1;
    s.panic_warning = { turns_left: 3 };
    resolveCounting(s, fixedRng(0.99), council);
    // The correspondent warns, the spouse warns about the heir; the clerk sees no trouble and stays silent.
    expect(s.counting.advice.map((a) => a.advisor)).toEqual(["head_correspondent", "spouse"]);
    expect(s.counting.advice[0]!.text).toMatch(/I fear a panic within the year/);
    s.world.turn += 1;
    s.world.quarter = 2;
    resolveCounting(s, fixedRng(0.99), council);
    expect(s.counting.advice).toEqual([]);
  });

  it("are sometimes wrong: a low roll makes the clerk see trouble that is not there", () => {
    const s = house();
    s.world.quarter = 1;
    resolveCounting(s, fixedRng(0, 0.99, 0.99), council);
    expect(s.counting.advice[0]).toMatchObject({ advisor: "chief_clerk", alarm: true, correct: false });
  });

  it("roll nothing when silenced, so other systems' tests count their rolls", () => {
    const s = house();
    let rolls = 0;
    const count = { next: () => (rolls++, 0.5) };
    const quietHouse = createCounting(quiet, createRng(1));
    s.counting = quietHouse;
    resolveCounting(s, count, quiet);
    expect(rolls).toBe(0);
  });
});
