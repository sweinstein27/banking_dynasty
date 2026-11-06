import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondBook } from "../src/sim/bonds";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { raiseCash, ventureSalePrice } from "../src/sim/liquidity";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, InvestVentureDecision } from "../src/sim/types";
import {
  checkInvestVenture,
  investVenture,
  quartersLeft,
  ventureBook,
  ventureFailureChance,
  venturePayout,
} from "../src/sim/ventures";
import { fixedRng, fresh, GOOD, noDefaults, quiet } from "./helpers";

const tuning = gameData.tuning;
const type = (id: string) => gameData.ventures.find((v) => v.id === id)!;
const invest = (venture: string, amount = 10000): InvestVentureDecision => ({ kind: "invest_venture", venture, amount });

function applyOk(state: GameState, d: Decision): GameState {
  const r = applyDecision(state, d, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reconciles(s: GameState) {
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "loans")).toBe(loanBook(s));
  expect(accountBalance(s, "bonds")).toBe(bondBook(s));
  expect(accountBalance(s, "ventures")).toBe(ventureBook(s));
  expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
}

/** Plays `n` quiet turns: nothing defaults, ventures succeed, the mood stays calm. */
function idle(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = endTurn(s, [], noDefaults, quiet);
  return s;
}

describe("ventures data", () => {
  it("has unique ids and sane numbers", () => {
    const ids = gameData.ventures.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of gameData.ventures) {
      expect(v.term_quarters).toBeGreaterThan(0);
      expect(v.failure_risk).toBeGreaterThanOrEqual(0);
      expect(v.failure_risk).toBeLessThanOrEqual(1);
    }
  });
});

describe("venture maths", () => {
  it("pays back the stake plus the expected return, rounded", () => {
    expect(venturePayout({ invested: 10000, expected_return: 0.4 })).toBe(14000);
    expect(venturePayout({ invested: 3333, expected_return: 0.3 })).toBe(4333);
  });

  it("scales failure risk with sentiment, capped at 1", () => {
    expect(ventureFailureChance(0.15, "calm", tuning, 5, 1)).toBeCloseTo(0.15);
    expect(ventureFailureChance(0.15, "uneasy", tuning, 5, 1)).toBeCloseTo(0.3);
    expect(ventureFailureChance(0.3, "panic", tuning, 5, 1)).toBe(1);
  });
});

describe("investVenture", () => {
  it("locks cash into the venture and uses an action", () => {
    const s0 = fresh();
    const s1 = applyOk(s0, invest("mill"));
    expect(s1.house.cash).toBe(s0.house.cash - 10000);
    expect(s1.ventures[0]).toMatchObject({ type: "mill", invested: 10000, status: "active", start_turn: 1 });
    expect(s1.actions_this_turn).toBe(1);
    expect(netWorth(s1)).toBe(netWorth(s0));
    reconciles(s1);
  });

  it("does not change the input state", () => {
    const s0 = fresh();
    const before = structuredClone(s0);
    applyOk(s0, invest("mill"));
    expect(s0).toEqual(before);
  });

  it("refuses a railway before 1836, after the first German line opens, and allows it from then", () => {
    const s = fresh();
    expect(checkInvestVenture(s, invest("railway"), gameData)).toMatch(/before 1836/);
    s.world.year = type("railway").unlock_year;
    expect(checkInvestVenture(s, invest("railway"), gameData)).toBeNull();
  });

  it("refuses unknown types, small or fractional amounts", () => {
    const s = fresh();
    expect(checkInvestVenture(s, invest("canal"), gameData)).toMatch(/Unknown venture/);
    expect(checkInvestVenture(s, invest("mill", tuning.ventures.min_amount - 1), gameData)).toMatch(/at least/);
    expect(checkInvestVenture(s, invest("mill", 5000.5), gameData)).toMatch(/whole/);
  });

  it("refuses to spend below the reserve, and with zero cash", () => {
    const s = fresh();
    s.house.reserve = 90000;
    expect(checkInvestVenture(s, invest("mill", 10000), gameData)).toBeNull();
    expect(checkInvestVenture(s, invest("mill", 10001), gameData)).toMatch(/above the reserve/);
    s.house.cash = 0;
    expect(checkInvestVenture(s, invest("mill"), gameData)).toMatch(/above the reserve/);
  });

  it("shares the turn's actions with other decisions", () => {
    let s = fresh();
    s = applyOk(s, invest("mill"));
    s = applyOk(s, { kind: "buy_bond", state: "bavaria", face_value: 5000 });
    s = applyOk(s, { kind: "lend", amount: 5000, rate: 0.06, borrower: GOOD });
    expect(checkInvestVenture(s, invest("shipping"), gameData)).toMatch(/No actions left/);
  });

  it("returns a reason instead of throwing", () => {
    expect(investVenture(fresh(), invest("canal"), gameData).ok).toBe(false);
  });
});

describe("endTurn: ventures", () => {
  it("keeps capital locked, with no income and no roll, until the term", () => {
    const mill = type("mill");
    let s = endTurn(fresh(), [invest("mill")], noDefaults, quiet);
    const cash = s.house.cash;
    let calls = 0;
    const counting = { next: () => (calls++, 0.999999) };
    for (let i = 1; i < mill.term_quarters - 1; i++) s = endTurn(s, [], counting, quiet);
    expect(s.ventures[0]!.status).toBe("active");
    expect(s.house.cash).toBe(cash);
    expect(calls).toBe(2 * (mill.term_quarters - 2)); // only the mood and random-event rolls
    expect(quartersLeft(s, s.ventures[0]!)).toBe(1);
  });

  it("pays out at the end of its term on success", () => {
    const mill = type("mill");
    const s0 = fresh();
    const s = idle(endTurn(s0, [invest("mill")], noDefaults, quiet), mill.term_quarters - 1);
    expect(s.ventures[0]!.status).toBe("paid_out");
    expect(s.house.cash).toBe(s0.house.cash - 10000 + 14000);
    expect(netWorth(s)).toBe(netWorth(s0) + 4000);
    reconciles(s);
  });

  it("loses the whole stake on failure", () => {
    const shipping = type("shipping");
    let s = fresh();
    s = idle(endTurn(s, [invest("shipping")], noDefaults, quiet), shipping.term_quarters - 2);
    const before = netWorth(s);
    s = endTurn(s, [], fixedRng(0, 0.999999), quiet); // venture fails, mood stays calm
    expect(s.ventures[0]!.status).toBe("failed");
    expect(netWorth(s)).toBe(before - 10000);
    reconciles(s);
  });

  it("uses the mood at maturity: a roll that succeeds when calm fails in a panic", () => {
    const mill = type("mill");
    let s = fresh();
    s = idle(endTurn(s, [invest("mill")], noDefaults, quiet), mill.term_quarters - 2);
    const roll = mill.failure_risk * 2; // above the calm chance, below the panic chance
    const calm = endTurn(s, [], fixedRng(roll, 0.999999), quiet);
    const panicked = structuredClone(s);
    panicked.world.sentiment = "panic";
    panicked.house.deposits = 0; // no run, to isolate the venture
    const panic = endTurn(panicked, [], fixedRng(roll, 0.999999), quiet);
    expect(calm.ventures[0]!.status).toBe("paid_out");
    expect(panic.ventures[0]!.status).toBe("failed");
  });

  it("never resolves a venture twice", () => {
    const mill = type("mill");
    let s = idle(endTurn(fresh(), [invest("mill")], noDefaults, quiet), mill.term_quarters - 1);
    const cash = s.house.cash;
    s = idle(s, 3);
    expect(s.house.cash).toBe(cash);
    expect(s.ledger.filter((e) => e.category === "venture_payout")).toHaveLength(2);
  });
});

describe("forced sales of ventures", () => {
  it("come last, after bonds and loans, at the steepest discount", () => {
    let s = fresh();
    s = applyOk(s, { kind: "buy_bond", state: "bavaria", face_value: 2000 });
    s = applyOk(s, { kind: "lend", amount: 2000, rate: 0.06, borrower: GOOD });
    s = applyOk(s, invest("mill", 20000));
    s.ledger.push({ id: 0, turn: 1, account: "cash", category: "opening", amount: -s.house.cash, note: "test" });
    s.house.cash = 0;
    raiseCash(s, 5000, tuning);
    expect(s.bonds[0]!.status).toBe("sold");
    expect(s.loans[0]!.status).toBe("sold");
    expect(s.ventures[0]!.status).toBe("active");
    expect(s.ventures[0]!.invested).toBeLessThan(20000);
    expect(s.house.cash).toBeGreaterThanOrEqual(5000);
    reconciles(s);
  });

  it("sell only the slice needed; the rest still pays out in proportion", () => {
    const mill = type("mill");
    let s = fresh();
    s = applyOk(s, invest("mill", 20000));
    s.ledger.push({ id: 0, turn: 1, account: "cash", category: "opening", amount: -s.house.cash, note: "test" });
    s.house.cash = 0;
    raiseCash(s, 3000, tuning);
    const kept = s.ventures[0]!.invested;
    expect(ventureSalePrice(20000 - kept, tuning)).toBeGreaterThanOrEqual(3000);
    s.house.deposits = 0;
    s.ledger.push({ id: 0, turn: 1, account: "deposits", category: "opening", amount: -accountBalance(s, "deposits"), note: "test" });
    s = idle(s, mill.term_quarters);
    expect(s.ventures[0]!.status).toBe("paid_out");
    expect(s.ledger.find((e) => e.category === "venture_payout" && e.account === "cash")!.amount).toBe(
      venturePayout({ invested: kept, expected_return: mill.expected_return }),
    );
    reconciles(s);
  });
});
