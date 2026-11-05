import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { LendDecision } from "../src/sim/types";
import { fixedRng, noDefaults } from "./helpers";

const lendFair: LendDecision = { kind: "lend", amount: 10000, rate: 0.08, tier: "fair" };

describe("endTurn: calendar", () => {
  it("advances one quarter", () => {
    const s = endTurn(newGame(gameData), [], noDefaults, gameData);
    expect(s.world).toMatchObject({ turn: 2, year: 1815, quarter: 2 });
  });

  it("rolls Q4 over to Q1 of the next year", () => {
    let s = newGame(gameData);
    for (let i = 0; i < 4; i++) s = endTurn(s, [], noDefaults, gameData);
    expect(s.world).toMatchObject({ turn: 5, year: 1816, quarter: 1 });
  });

  it("does not change the input state", () => {
    const s0 = newGame(gameData);
    const before = structuredClone(s0);
    endTurn(s0, [lendFair], noDefaults, gameData);
    expect(s0).toEqual(before);
  });
});

describe("endTurn: interest and repayment", () => {
  it("collects interest in the quarter the loan is made", () => {
    const s0 = newGame(gameData);
    const s1 = endTurn(s0, [lendFair], noDefaults, gameData);
    expect(s1.house.cash).toBe(s0.house.cash - 10000 + 200);
    expect(s1.ledger.filter((e) => e.category === "interest")).toHaveLength(1);
  });

  it("repays principal after the term and stops paying interest", () => {
    let s = newGame(gameData);
    const start = s.house.cash;
    s = endTurn(s, [lendFair], noDefaults, gameData);
    for (let i = 1; i < gameData.tuning.loans.term_quarters; i++) s = endTurn(s, [], noDefaults, gameData);
    expect(s.loans[0]!.status).toBe("repaid");
    expect(s.house.cash).toBe(start + 200 * gameData.tuning.loans.term_quarters);
    expect(loanBook(s)).toBe(0);

    const after = endTurn(s, [], noDefaults, gameData);
    expect(after.house.cash).toBe(s.house.cash);
  });

  it("throws on an invalid decision", () => {
    expect(() => endTurn(newGame(gameData), [{ ...lendFair, amount: 10_000_000 }], noDefaults, gameData)).toThrow(
      /Not enough cash/,
    );
  });
});

describe("endTurn: defaults", () => {
  it("writes off the principal and pays no interest when the roll defaults", () => {
    const s0 = newGame(gameData);
    const s1 = endTurn(s0, [lendFair], fixedRng(0), gameData);
    expect(s1.loans[0]!.status).toBe("defaulted");
    expect(s1.house.cash).toBe(s0.house.cash - 10000);
    expect(loanBook(s1)).toBe(0);
    const entry = s1.ledger.find((e) => e.category === "default");
    expect(entry).toMatchObject({ account: "loans", amount: -10000, turn: 1 });
    expect(netWorth(s1)).toBe(netWorth(s0) - 10000);
  });

  it("uses the formula threshold: a roll just under p defaults, just over does not", () => {
    const p = gameData.tuning.loans.p0 * (1 - 0.6);
    const hit = endTurn(newGame(gameData), [lendFair], fixedRng(p - 1e-9), gameData);
    const miss = endTurn(newGame(gameData), [lendFair], fixedRng(p + 1e-9), gameData);
    expect(hit.loans[0]!.status).toBe("defaulted");
    expect(miss.loans[0]!.status).toBe("active");
  });

  it("never touches a defaulted loan again", () => {
    let s = endTurn(newGame(gameData), [lendFair], fixedRng(0), gameData);
    const cash = s.house.cash;
    s = endTurn(s, [], fixedRng(0), gameData);
    expect(s.house.cash).toBe(cash);
    expect(s.ledger.filter((e) => e.category === "default")).toHaveLength(1);
  });

  it("is more likely in a panic", () => {
    const p = gameData.tuning.loans.p0 * (1 - 0.6);
    const roll = p * 2; // misses when calm, hits in a panic (x5)
    const calm = newGame(gameData);
    const panic = newGame(gameData);
    panic.world.sentiment = "panic";
    expect(endTurn(calm, [lendFair], fixedRng(roll), gameData).loans[0]!.status).toBe("active");
    expect(endTurn(panic, [lendFair], fixedRng(roll), gameData).loans[0]!.status).toBe("defaulted");
  });
});

describe("netWorth and ledger", () => {
  it("starts at cash minus deposits", () => {
    const s = newGame(gameData);
    expect(netWorth(s)).toBe(gameData.tuning.start.cash - gameData.tuning.start.deposits);
  });

  it("is unchanged by lending itself", () => {
    const s0 = newGame(gameData);
    const r = endTurn(s0, [lendFair], noDefaults, gameData);
    expect(netWorth(r)).toBe(netWorth(s0) + 200);
  });

  it("reconciles every balance to the ledger", () => {
    let s = newGame(gameData);
    s = endTurn(s, [lendFair, { ...lendFair, tier: "poor", rate: 0.15 }], fixedRng(0.9, 0), gameData);
    s = endTurn(s, [], noDefaults, gameData);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(accountBalance(s, "loans")).toBe(loanBook(s));
    expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
  });
});
