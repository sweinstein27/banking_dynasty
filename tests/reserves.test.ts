import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { checkLend } from "../src/sim/loans";
import { checkSetReserve, freeCash, payWithdrawal, setReserve } from "../src/sim/reserves";
import { endTurn, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LendDecision, SetReserveDecision } from "../src/sim/types";
import { noDefaults, noEvents } from "./helpers";

const tuning = gameData.tuning;
const reserve = (amount: number): SetReserveDecision => ({ kind: "set_reserve", amount });
const lendGood = (amount: number): LendDecision => ({ kind: "lend", amount, rate: 0.06, tier: "good" });

function applyOk(state: GameState, d: Decision): GameState {
  const r = applyDecision(state, d, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("freeCash", () => {
  it("is cash above the reserve", () => {
    const s = newGame(gameData);
    s.house.reserve = 30000;
    expect(freeCash(s)).toBe(s.house.cash - 30000);
  });

  it("is zero, not negative, when cash is below the reserve", () => {
    const s = newGame(gameData);
    s.house.cash = 10000;
    s.house.reserve = 30000;
    expect(freeCash(s)).toBe(0);
  });

  it("is zero with zero cash", () => {
    const s = newGame(gameData);
    s.house.cash = 0;
    expect(freeCash(s)).toBe(0);
  });
});

describe("setReserve", () => {
  it("starts at the tuning value", () => {
    expect(newGame(gameData).house.reserve).toBe(tuning.start.reserve);
  });

  it("sets the floor, uses an action, and moves no money", () => {
    const s0 = newGame(gameData);
    const s1 = applyOk(s0, reserve(40000));
    expect(s1.house.reserve).toBe(40000);
    expect(s1.house.cash).toBe(s0.house.cash);
    expect(s1.actions_this_turn).toBe(1);
    expect(s1.ledger).toEqual(s0.ledger);
  });

  it("does not change the input state", () => {
    const s0 = newGame(gameData);
    const before = structuredClone(s0);
    applyOk(s0, reserve(40000));
    expect(s0).toEqual(before);
  });

  it("allows a reserve of zero", () => {
    const s = applyOk(applyOk(newGame(gameData), reserve(40000)), reserve(0));
    expect(s.house.reserve).toBe(0);
    expect(freeCash(s)).toBe(s.house.cash);
  });

  it("allows a reserve larger than cash, which blocks all spending", () => {
    const s0 = newGame(gameData);
    const s1 = applyOk(s0, reserve(s0.house.cash + 50000));
    expect(freeCash(s1)).toBe(0);
    expect(checkLend(s1, lendGood(1000), tuning)).toMatch(/Not enough cash above the reserve/);
  });

  it("refuses negative, fractional, or unchanged amounts", () => {
    const s = newGame(gameData);
    expect(checkSetReserve(s, reserve(-1), tuning)).toMatch(/negative/);
    expect(checkSetReserve(s, reserve(100.5), tuning)).toMatch(/whole/);
    expect(checkSetReserve(s, reserve(s.house.reserve), tuning)).toMatch(/already/);
  });

  it("returns a reason instead of throwing", () => {
    expect(setReserve(newGame(gameData), reserve(-5), tuning).ok).toBe(false);
  });
});

describe("reserve and lending", () => {
  it("lets lending use free cash exactly, and no more", () => {
    const s = applyOk(newGame(gameData), reserve(30000));
    const free = freeCash(s);
    expect(checkLend(s, lendGood(free), tuning)).toBeNull();
    expect(checkLend(s, lendGood(free + 1), tuning)).toMatch(/Not enough cash above the reserve/);
  });

  it("keeps the plain message when no reserve is set", () => {
    const s = newGame(gameData);
    expect(checkLend(s, lendGood(s.house.cash + 1), tuning)).toMatch(/^Not enough cash \(have/);
  });

  it("applies decisions in order: a reserve set first limits a later loan in the same turn", () => {
    const s0 = newGame(gameData);
    const tooBig = lendGood(s0.house.cash - 10000);
    expect(() => endTurn(s0, [reserve(20000), tooBig], noDefaults, noEvents)).toThrow(/above the reserve/);
    expect(() => endTurn(s0, [tooBig, reserve(20000)], noDefaults, noEvents)).not.toThrow();
  });

  it("keeps the reserve across turns", () => {
    const s = endTurn(newGame(gameData), [reserve(25000)], noDefaults, noEvents);
    expect(s.house.reserve).toBe(25000);
  });
});

describe("actions are shared across decision types", () => {
  it("refuses a 4th action, whatever its kind", () => {
    let s = newGame(gameData);
    s = applyOk(s, reserve(10000));
    s = applyOk(s, lendGood(1000));
    s = applyOk(s, lendGood(1000));
    expect(s.actions_this_turn).toBe(tuning.actions_per_turn);
    expect(checkSetReserve(s, reserve(20000), tuning)).toMatch(/No actions left/);
    expect(checkLend(s, lendGood(1000), tuning)).toMatch(/No actions left/);
  });

  it("resets at the end of the turn", () => {
    const s = endTurn(newGame(gameData), [reserve(10000), lendGood(1000), lendGood(1000)], noDefaults, noEvents);
    expect(s.actions_this_turn).toBe(0);
  });
});

describe("payWithdrawal", () => {
  function withReserve(cash: number, reserveAmount: number, deposits = 50000): GameState {
    const s = newGame(gameData);
    s.house.cash = cash;
    s.house.reserve = reserveAmount;
    s.house.deposits = deposits;
    return s;
  }

  it("draws on the reserve first", () => {
    const s = withReserve(50000, 20000);
    const r = payWithdrawal(s, 15000, "Withdrawal");
    expect(r).toEqual({ fromReserve: 15000, fromFreeCash: 0, shortfall: 0 });
    expect(s.house.cash).toBe(35000);
    expect(s.house.deposits).toBe(35000);
  });

  it("then on free cash once the reserve is used", () => {
    const s = withReserve(50000, 20000);
    expect(payWithdrawal(s, 30000, "Withdrawal")).toEqual({ fromReserve: 20000, fromFreeCash: 10000, shortfall: 0 });
  });

  it("leaves the floor in place, so spending is blocked until cash is rebuilt", () => {
    const s = withReserve(50000, 20000);
    payWithdrawal(s, 35000, "Withdrawal");
    expect(s.house.reserve).toBe(20000);
    expect(freeCash(s)).toBe(0);
  });

  it("reports a shortfall when cash runs out", () => {
    const s = withReserve(10000, 20000);
    expect(payWithdrawal(s, 25000, "Withdrawal")).toEqual({ fromReserve: 10000, fromFreeCash: 0, shortfall: 15000 });
    expect(s.house.cash).toBe(0);
    expect(s.house.deposits).toBe(40000);
  });

  it("pays nothing and writes no entry with zero cash", () => {
    const s = withReserve(0, 20000);
    const entries = s.ledger.length;
    expect(payWithdrawal(s, 5000, "Withdrawal")).toEqual({ fromReserve: 0, fromFreeCash: 0, shortfall: 5000 });
    expect(s.ledger).toHaveLength(entries);
  });

  it("works with no reserve set", () => {
    const s = withReserve(50000, 0);
    expect(payWithdrawal(s, 5000, "Withdrawal")).toEqual({ fromReserve: 0, fromFreeCash: 5000, shortfall: 0 });
  });

  it("never withdraws more than is on deposit", () => {
    const s = withReserve(50000, 0, 3000);
    expect(payWithdrawal(s, 5000, "Withdrawal")).toEqual({ fromReserve: 0, fromFreeCash: 3000, shortfall: 0 });
    expect(s.house.deposits).toBe(0);
  });

  it("writes both ledger sides, keeps net worth, and reconciles", () => {
    const s = newGame(gameData);
    s.house.reserve = 20000;
    const before = netWorth(s);
    payWithdrawal(s, 12000, "Withdrawal");
    expect(netWorth(s)).toBe(before);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
    expect(s.ledger.filter((e) => e.category === "withdrawal").map((e) => e.amount)).toEqual([-12000, -12000]);
  });
});
