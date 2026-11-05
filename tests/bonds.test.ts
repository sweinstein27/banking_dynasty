import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import {
  bondBook,
  bondDefaultChance,
  bondPrice,
  bondValue,
  buyBond,
  checkBuyBond,
  markBonds,
  quarterlyCoupon,
} from "../src/sim/bonds";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { amountToSell, bondSaleRatio, raiseCash } from "../src/sim/liquidity";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { BuyBondDecision, Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, GOOD, noDefaults, quiet } from "./helpers";

const tuning = gameData.tuning;
const issuer = (id: string) => gameData.states.find((s) => s.id === id)!;
const buy = (state: string, face_value = 10000): BuyBondDecision => ({ kind: "buy_bond", state, face_value });

function applyOk(state: GameState, d: Decision): GameState {
  const r = applyDecision(state, d, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reconciles(s: GameState) {
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "loans")).toBe(loanBook(s));
  expect(accountBalance(s, "bonds")).toBe(bondBook(s));
  expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
}

describe("states data", () => {
  it("has unique ids and sane numbers", () => {
    const ids = gameData.states.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of gameData.states) {
      expect(s.risk).toBeGreaterThanOrEqual(0);
      expect(s.risk).toBeLessThanOrEqual(1);
      expect(s.coupon).toBeGreaterThan(0);
    }
  });
});

describe("bondPrice", () => {
  it("is par when calm", () => {
    expect(bondPrice(0.6, "calm", tuning)).toBe(1);
  });

  it("falls with sentiment, more for riskier states", () => {
    const k = tuning.bonds.price_sensitivity;
    expect(bondPrice(0.5, "uneasy", tuning)).toBeCloseTo(1 - k * 0.5 * 1);
    expect(bondPrice(0.5, "panic", tuning)).toBeCloseTo(1 - k * 0.5 * 4);
    expect(bondPrice(0.6, "panic", tuning)).toBeLessThan(bondPrice(0.15, "panic", tuning));
  });

  it("never falls below the floor", () => {
    const harsh = structuredClone(tuning);
    harsh.bonds.price_sensitivity = 10;
    expect(bondPrice(1, "panic", harsh)).toBe(harsh.bonds.price_floor);
  });

  it("is zero-risk proof: a riskless state stays at par in a panic", () => {
    expect(bondPrice(0, "panic", tuning)).toBe(1);
  });
});

describe("coupons and default chance", () => {
  it("pays a quarter of the annual coupon on face value, rounded", () => {
    expect(quarterlyCoupon({ face_value: 10000, coupon: 0.05 })).toBe(125);
    expect(quarterlyCoupon({ face_value: 1001, coupon: 0.06 })).toBe(15);
  });

  it("defaults with chance p0 * m * risk", () => {
    expect(bondDefaultChance(0.5, "calm", tuning)).toBeCloseTo(tuning.bonds.p0 * 0.5);
    expect(bondDefaultChance(0.5, "panic", tuning)).toBeCloseTo(tuning.bonds.p0 * 5 * 0.5);
    expect(bondDefaultChance(0, "panic", tuning)).toBe(0);
  });
});

describe("buyBond", () => {
  it("moves cash into bonds at the current price and uses an action", () => {
    const s0 = fresh();
    const s1 = applyOk(s0, buy("bavaria"));
    expect(s1.house.cash).toBe(s0.house.cash - 10000);
    expect(s1.bonds[0]).toMatchObject({ issuer_state: "bavaria", face_value: 10000, price: 1, status: "active" });
    expect(s1.actions_this_turn).toBe(1);
    expect(netWorth(s1)).toBe(netWorth(s0));
    reconciles(s1);
  });

  it("costs less when sentiment has pushed the price down", () => {
    const s0 = fresh();
    s0.world.sentiment = "panic";
    const s1 = applyOk(s0, buy("naples"));
    const price = bondPrice(issuer("naples").risk, "panic", tuning);
    expect(s1.bonds[0]!.price).toBe(price);
    expect(s0.house.cash - s1.house.cash).toBe(Math.round(10000 * price));
  });

  it("does not change the input state", () => {
    const s0 = fresh();
    const before = structuredClone(s0);
    applyOk(s0, buy("bavaria"));
    expect(s0).toEqual(before);
  });

  it("refuses a state whose reputation bar the house does not meet", () => {
    const s = fresh();
    expect(s.house.reputation).toBeLessThan(issuer("prussia").min_reputation);
    expect(checkBuyBond(s, buy("prussia"), gameData)).toMatch(/reputation/);
    s.house.reputation = issuer("prussia").min_reputation;
    expect(checkBuyBond(s, buy("prussia"), gameData)).toBeNull();
  });

  it("refuses unknown states, small or fractional amounts", () => {
    const s = fresh();
    expect(checkBuyBond(s, buy("atlantis"), gameData)).toMatch(/Unknown state/);
    expect(checkBuyBond(s, buy("bavaria", tuning.bonds.min_amount - 1), gameData)).toMatch(/at least/);
    expect(checkBuyBond(s, buy("bavaria", 1500.5), gameData)).toMatch(/whole/);
  });

  it("refuses to spend below the reserve, and with zero cash", () => {
    const s = fresh();
    s.house.reserve = 95000;
    expect(checkBuyBond(s, buy("bavaria", 5000), gameData)).toBeNull();
    expect(checkBuyBond(s, buy("bavaria", 5001), gameData)).toMatch(/above the reserve \(cost 5,001 fl\., free 5,000 fl\.\)/);
    s.house.cash = 0;
    s.house.reserve = 0;
    expect(checkBuyBond(s, buy("bavaria"), gameData)).toMatch(/above the reserve/);
  });

  it("refuses a state that has defaulted", () => {
    const s = fresh();
    s.defaulted_states.push("naples");
    expect(checkBuyBond(s, buy("naples"), gameData)).toMatch(/defaulted/);
  });

  it("shares the turn's actions with other decisions", () => {
    let s = fresh();
    s = applyOk(s, buy("bavaria"));
    s = applyOk(s, { kind: "set_reserve", amount: 1000 });
    s = applyOk(s, buy("austria"));
    expect(checkBuyBond(s, buy("france"), gameData)).toMatch(/No actions left/);
  });

  it("returns a reason instead of throwing", () => {
    expect(buyBond(fresh(), buy("atlantis"), gameData).ok).toBe(false);
  });
});

describe("endTurn: bonds", () => {
  it("pays a coupon in the quarter of purchase and every quarter after", () => {
    const s0 = fresh();
    let s = endTurn(s0, [buy("bavaria")], noDefaults, quiet);
    expect(s.house.cash).toBe(s0.house.cash - 10000 + 125);
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.house.cash).toBe(s0.house.cash - 10000 + 250);
    reconciles(s);
  });

  it("writes off every holding of a state that defaults, with no coupon", () => {
    let s = fresh();
    s = endTurn(s, [buy("naples"), buy("naples", 5000), buy("bavaria")], fixedRng(0.999999), quiet);
    const before = netWorth(s);
    // Rolls in states.json order: bavaria survives, naples defaults, then the mood roll stays calm.
    s = endTurn(s, [], fixedRng(0.999999, 0, 0.999999), quiet);
    expect(s.bonds.map((b) => b.status)).toEqual(["defaulted", "defaulted", "active"]);
    expect(s.defaulted_states).toEqual(["naples"]);
    expect(netWorth(s)).toBe(before - 15000 + 125);
    expect(s.ledger.filter((e) => e.category === "coupon" && e.turn === 2)).toHaveLength(1);
    reconciles(s);
  });

  it("uses the formula threshold for a state default", () => {
    const p = bondDefaultChance(issuer("naples").risk, "calm", tuning);
    const hit = endTurn(fresh(), [buy("naples")], fixedRng(p - 1e-9, 0.999999), quiet);
    const miss = endTurn(fresh(), [buy("naples")], fixedRng(p + 1e-9, 0.999999), quiet);
    expect(hit.bonds[0]!.status).toBe("defaulted");
    expect(miss.bonds[0]!.status).toBe("active");
  });

  it("rolls once per state held, not per holding, and not for states not held", () => {
    let calls = 0;
    const rng = { next: () => (calls++, 0.999999) };
    endTurn(fresh(), [buy("bavaria"), buy("bavaria", 2000), buy("austria")], rng, quiet);
    expect(calls).toBe(2 + 2); // bavaria, austria, then the mood and the random-event roll
  });

  it("never rolls or pays again for a defaulted holding", () => {
    let s = endTurn(fresh(), [buy("naples")], fixedRng(0, 0.999999), quiet);
    let calls = 0;
    s = endTurn(s, [], { next: () => (calls++, 0.999999) }, quiet);
    expect(calls).toBe(2); // the mood and the random-event roll
    expect(s.ledger.filter((e) => e.category === "coupon")).toHaveLength(0);
  });
});

describe("markBonds", () => {
  it("reprices holdings when the mood changes and writes a revaluation", () => {
    // Buy while calm, then the mood roll turns uneasy.
    const s = endTurn(fresh(), [buy("france")], fixedRng(0.999999, 0), quiet);
    expect(s.world.sentiment).toBe("uneasy");
    const price = bondPrice(issuer("france").risk, "uneasy", tuning);
    expect(s.bonds[0]!.price).toBe(price);
    const reval = s.ledger.filter((e) => e.category === "revaluation");
    expect(reval).toHaveLength(1);
    expect(reval[0]!.amount).toBe(Math.round(10000 * price) - 10000);
    reconciles(s);
  });

  it("writes nothing when the price does not change", () => {
    const s = applyOk(fresh(), buy("bavaria"));
    const n = s.ledger.length;
    markBonds(s, gameData);
    expect(s.ledger).toHaveLength(n);
  });

  it("recovers the price when the mood calms again", () => {
    let s = fresh();
    s.world.sentiment = "uneasy";
    s = endTurn(s, [buy("france")], fixedRng(0.999999, 0), quiet); // uneasy -> calm
    expect(s.world.sentiment).toBe("calm");
    expect(s.bonds[0]!.price).toBe(1);
    expect(bondValue(s.bonds[0]!)).toBe(10000);
    reconciles(s);
  });
});

describe("forced sales of bonds", () => {
  it("sell bonds before loans, at the market price less the discount", () => {
    let s = fresh();
    s = applyOk(s, { kind: "lend", amount: 20000, rate: 0.06, borrower: GOOD });
    s = applyOk(s, buy("bavaria", 20000));
    s.house.cash = 0;
    s.ledger.push({ id: 0, turn: 1, account: "cash", category: "opening", amount: -accountBalance(s, "cash"), note: "test" });
    const raised = raiseCash(s, 5000, tuning);
    expect(raised).toBeGreaterThanOrEqual(5000);
    expect(s.loans[0]!.principal).toBe(20000);
    const ratio = bondSaleRatio({ price: 1 }, tuning);
    const face = amountToSell(5000, 20000, ratio);
    expect(s.bonds[0]).toMatchObject({ status: "active", face_value: 20000 - face });
    reconciles(s);
  });

  it("move on to loans once bonds are all sold", () => {
    let s = fresh();
    s = applyOk(s, { kind: "lend", amount: 20000, rate: 0.06, borrower: GOOD });
    s = applyOk(s, buy("bavaria", 2000));
    s.house.cash = 0;
    s.ledger.push({ id: 0, turn: 1, account: "cash", category: "opening", amount: -accountBalance(s, "cash"), note: "test" });
    raiseCash(s, 5000, tuning);
    expect(s.bonds[0]!.status).toBe("sold");
    expect(s.loans[0]!.principal).toBeLessThan(20000);
    reconciles(s);
  });

  it("can save a house from bankruptcy in a panic run", () => {
    let s = fresh();
    // 5,000 cash + 1,188 coupon cannot meet a 10,000 panic withdrawal without selling bonds.
    s = applyOk(s, buy("bavaria", 95000));
    s.world.sentiment = "panic";
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.house.status).toBe("solvent");
    expect(s.bonds[0]!.face_value).toBeLessThan(95000);
    reconciles(s);
  });
});
