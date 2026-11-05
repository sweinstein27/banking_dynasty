import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { checkLend, defaultChance, lend, quarterlyInterest } from "../src/sim/loans";
import type { GameState, LendDecision } from "../src/sim/types";

const tuning = gameData.tuning;
const good: LendDecision = { kind: "lend", amount: 10000, rate: 0.06, tier: "good" };

function lendOk(state: GameState, d: LendDecision): GameState {
  const r = lend(state, d, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("quarterlyInterest", () => {
  it("is a quarter of the annual rate", () => {
    expect(quarterlyInterest({ principal: 10000, rate: 0.08 })).toBe(200);
  });

  it("rounds to whole gulden", () => {
    expect(quarterlyInterest({ principal: 1001, rate: 0.06 })).toBe(15); // 15.015
    expect(quarterlyInterest({ principal: 1010, rate: 0.06 })).toBe(15); // 15.15
    expect(quarterlyInterest({ principal: 1030, rate: 0.06 })).toBe(15); // 15.45
    expect(quarterlyInterest({ principal: 1034, rate: 0.06 })).toBe(16); // 15.51
  });

  it("is zero for a zero rate", () => {
    expect(quarterlyInterest({ principal: 5000, rate: 0 })).toBe(0);
  });
});

describe("defaultChance", () => {
  it("is zero for a perfect borrower", () => {
    expect(defaultChance(1, "panic", tuning)).toBe(0);
  });

  it("is p0 times the sentiment multiplier for the worst borrower", () => {
    expect(defaultChance(0, "calm", tuning)).toBeCloseTo(tuning.loans.p0);
    expect(defaultChance(0, "uneasy", tuning)).toBeCloseTo(tuning.loans.p0 * 2);
    expect(defaultChance(0, "panic", tuning)).toBeCloseTo(tuning.loans.p0 * 5);
  });

  it("scales with (1 - q)", () => {
    expect(defaultChance(0.75, "calm", tuning)).toBeCloseTo(tuning.loans.p0 * 0.25);
  });
});

describe("lend", () => {
  it("moves cash into the loan book and writes both ledger sides", () => {
    const s0 = newGame(gameData);
    const s1 = lendOk(s0, good);
    expect(s1.house.cash).toBe(s0.house.cash - 10000);
    expect(s1.loans).toHaveLength(1);
    expect(s1.loans[0]).toMatchObject({ principal: 10000, rate: 0.06, quality: 0.9, status: "active", start_turn: 1 });
    expect(accountBalance(s1, "cash")).toBe(s1.house.cash);
    expect(accountBalance(s1, "loans")).toBe(10000);
  });

  it("does not change the input state", () => {
    const s0 = newGame(gameData);
    const before = structuredClone(s0);
    lendOk(s0, good);
    expect(s0).toEqual(before);
  });

  it("allows lending every last gulden", () => {
    const s0 = newGame(gameData);
    const s1 = lendOk(s0, { ...good, amount: s0.house.cash });
    expect(s1.house.cash).toBe(0);
  });

  it("refuses with zero cash", () => {
    const s0 = newGame(gameData);
    s0.house.cash = 0;
    expect(checkLend(s0, good, tuning)).toMatch(/Not enough cash/);
  });

  it("refuses more than the cash on hand", () => {
    const s0 = newGame(gameData);
    expect(checkLend(s0, { ...good, amount: s0.house.cash + 1 }, tuning)).toMatch(/Not enough cash/);
  });

  it("refuses a rate above the tier's maximum", () => {
    const s0 = newGame(gameData);
    expect(checkLend(s0, { ...good, rate: 0.061 }, tuning)).toMatch(/will not pay more/);
    expect(checkLend(s0, { ...good, tier: "poor", rate: 0.16 }, tuning)).toBeNull();
  });

  it("refuses zero or negative rates", () => {
    const s0 = newGame(gameData);
    expect(checkLend(s0, { ...good, rate: 0 }, tuning)).toMatch(/above zero/);
    expect(checkLend(s0, { ...good, rate: -0.01 }, tuning)).toMatch(/above zero/);
  });

  it("refuses amounts below the minimum or not whole", () => {
    const s0 = newGame(gameData);
    expect(checkLend(s0, { ...good, amount: 999 }, tuning)).toMatch(/at least/);
    expect(checkLend(s0, { ...good, amount: 1500.5 }, tuning)).toMatch(/whole/);
  });

  it("refuses after the turn's actions are used up", () => {
    let s = newGame(gameData);
    for (let i = 0; i < tuning.loans.actions_per_turn; i++) s = lendOk(s, { ...good, amount: 1000 });
    expect(checkLend(s, { ...good, amount: 1000 }, tuning)).toMatch(/No actions left/);
  });

  it("returns a reason instead of throwing", () => {
    const r = lend(newGame(gameData), { ...good, rate: 0.5 }, gameData);
    expect(r.ok).toBe(false);
  });
});
