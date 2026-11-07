import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondBook } from "../src/sim/bonds";
import { debtBook } from "../src/sim/crisis";
import { applyDecision } from "../src/sim/decisions";
import { accountBalance } from "../src/sim/ledger";
import { raiseCash, ventureSalePrice } from "../src/sim/liquidity";
import { commoditiesBook, sharesBook } from "../src/sim/systems/markets";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { Decision, GameState, InvestVentureDecision, Quarter } from "../src/sim/types";
import {
  buildFailureChance,
  checkInvestVenture,
  nextCall,
  quarterlyFailureRisk,
  remainingCommitment,
  stakeSalePrice,
  stepVentures,
  ventureBook,
  ventureFailureChance,
  venturePayout,
} from "../src/sim/ventures";
import { fixedRng, fresh, GOOD, noDefaults, quiet } from "./helpers";

const tuning = gameData.tuning;
const type = (id: string) => gameData.ventures.find((v) => v.id === id)!;
const invest = (venture: string, amount = 10000): InvestVentureDecision => ({ kind: "invest_venture", venture, amount });
/** 0.5 draws no failure, no overrun and no earnings noise. */
const neutral = () => fixedRng(0.5);

function applyOk(state: GameState, d: Decision, data: GameData = gameData): GameState {
  const r = applyDecision(state, d, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reconciles(s: GameState) {
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "loans")).toBe(loanBook(s));
  expect(accountBalance(s, "bonds")).toBe(bondBook(s));
  expect(accountBalance(s, "ventures")).toBe(ventureBook(s));
  expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
  expect(accountBalance(s, "borrowings")).toBe(debtBook(s));
  expect(accountBalance(s, "shares")).toBe(sharesBook(s));
  expect(accountBalance(s, "commodities")).toBe(commoditiesBook(s));
}

/** Moves the calendar on a quarter, as End Turn does, without resolving anything. */
function tick(s: GameState): void {
  s.world.turn += 1;
  if (s.world.quarter === 4) {
    s.world.quarter = 1;
    s.world.year += 1;
  } else s.world.quarter = (s.world.quarter + 1) as Quarter;
}

/** Resolves ventures for `n` quarters with neutral draws, moving the clock after each. Returns the state after the last tick. */
function run(s: GameState, n: number, rng = neutral): GameState {
  for (let i = 0; i < n; i++) {
    stepVentures(s, rng(), gameData);
    tick(s);
  }
  return s;
}

describe("ventures data", () => {
  it("has unique ids, a plan that adds up, and lengths in each tier's range", () => {
    const ids = gameData.ventures.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sectors = gameData.markets.sectors.map((s) => s.id);
    for (const v of gameData.ventures) {
      expect(v.calls * v.call_every).toBe(v.term_quarters);
      expect(v.failure_risk).toBeGreaterThanOrEqual(0);
      expect(v.failure_risk).toBeLessThanOrEqual(1);
      expect(sectors).toContain(v.sector);
      const years = (v.term_quarters + v.prove_quarters) / 4;
      if (v.tier === "short") expect(years).toBeGreaterThanOrEqual(1), expect(years).toBeLessThanOrEqual(2);
      if (v.tier === "medium") expect(years).toBeGreaterThanOrEqual(3), expect(years).toBeLessThanOrEqual(8);
      if (v.tier === "great") expect(v.term_quarters / 4).toBeGreaterThanOrEqual(15), expect(v.term_quarters / 4).toBeLessThanOrEqual(25);
      if (v.tier !== "short") expect(v.company_name).not.toBe("");
    }
  });
});

describe("venture maths", () => {
  it("pays a short venture back its stake plus the expected return, rounded", () => {
    expect(venturePayout({ invested: 10000, expected_return: 0.4 })).toBe(14000);
    expect(venturePayout({ invested: 3333, expected_return: 0.3 })).toBe(4333);
  });

  it("scales failure risk with sentiment, capped at 1", () => {
    expect(ventureFailureChance(0.15, "calm", tuning, 5, 1)).toBeCloseTo(0.15);
    expect(ventureFailureChance(0.15, "uneasy", tuning, 5, 1)).toBeCloseTo(0.3);
    expect(ventureFailureChance(0.3, "panic", tuning, 5, 1)).toBe(1);
  });

  it("spreads the whole build's risk so its quarters compound back to it", () => {
    const q = quarterlyFailureRisk(type("railway"));
    expect(1 - (1 - q) ** type("railway").term_quarters).toBeCloseTo(type("railway").failure_risk);
    expect(buildFailureChance(fresh(), type("railway"), gameData)).toBeCloseTo(q);
  });
});

describe("committing to a venture", () => {
  it("pays the first call, records the commitment and uses an action", () => {
    const s0 = fresh();
    const s1 = applyOk(s0, invest("mill", 16000));
    expect(s1.house.cash).toBe(s0.house.cash - 2000);
    expect(s1.ventures[0]).toMatchObject({ type: "mill", invested: 2000, committed: 16000, called: 2000, calls: 8, calls_paid: 1, status: "active", phase: "building", start_turn: 1 });
    expect(s1.actions_this_turn).toBe(1);
    expect(netWorth(s1)).toBe(netWorth(s0));
    expect(remainingCommitment(s1.ventures[0]!)).toBe(14000);
    expect(nextCall(s1.ventures[0]!)).toBe(2000);
    reconciles(s1);
  });

  it("refuses unknown types, small or fractional amounts and locked types", () => {
    const s = fresh();
    expect(checkInvestVenture(s, invest("zeppelin"), gameData)).toMatch(/Unknown/);
    expect(checkInvestVenture(s, invest("mill", 100), gameData)).toMatch(/at least/);
    expect(checkInvestVenture(s, invest("mill", 10000.5), gameData)).toMatch(/whole/);
    expect(checkInvestVenture(s, invest("railway"), gameData)).toMatch(/before 1836/);
  });

  it("needs only the first call in free cash, and refuses with zero cash", () => {
    const s = fresh();
    s.house.cash = 2000;
    expect(checkInvestVenture(s, invest("mill", 16000), gameData)).toBeNull();
    expect(checkInvestVenture(s, invest("mill", 16008), gameData)).toMatch(/first call/);
    s.house.cash = 0;
    expect(checkInvestVenture(s, invest("brewery", 5000), gameData)).toMatch(/first call/);
  });

  it("shares the quarter's capacity with other decisions", () => {
    let s = fresh();
    s = applyOk(s, invest("mill"));
    s = applyOk(s, { kind: "buy_bond", state: "bavaria", face_value: 5000 });
    s = applyOk(s, { kind: "lend", amount: 5000, rate: 0.06, borrower: GOOD });
    // A2: two clerks and one of the head's time so far; spend the other.
    s.counting.used.head = gameData.tuning.capacity.head;
    expect(checkInvestVenture(s, invest("shipping"), gameData)).toMatch(/No clerk is free/);
  });
});

describe("calls and the build", () => {
  it("calls the rest in equal instalments, then a short venture pays out once", () => {
    const s = applyOk(fresh(), invest("brewery", 10000));
    const cash0 = s.house.cash;
    // End Turn resolves ventures in the quarter they are committed too: no call then.
    run(s, 3);
    expect(s.ventures[0]).toMatchObject({ calls_paid: 3, invested: 7500, status: "active" });
    expect(s.house.cash).toBe(cash0 - 5000);
    stepVentures(s, neutral(), gameData); // the last call, then the payout
    expect(s.ventures[0]!.status).toBe("paid_out");
    expect(s.house.cash).toBe(cash0 - 7500 + 11200);
    reconciles(s);
  });

  it("calls great works once a year", () => {
    const s = fresh();
    s.world.year = 1836;
    const s1 = applyOk(s, invest("railway", 150000));
    run(s1, 4);
    expect(s1.ventures[0]!.calls_paid).toBe(1);
    run(s1, 1);
    expect(s1.ventures[0]!.calls_paid).toBe(2);
    expect(s1.ventures[0]!.invested).toBe(20000);
  });

  it("raises the commitment and lengthens the build on an overrun", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    tick(s);
    // Turn 2: no failure (0.9), then an overrun (0).
    stepVentures(s, fixedRng(0.9, 0), gameData);
    const v = s.ventures[0]!;
    expect(v.committed).toBe(17600);
    expect(v.calls).toBe(9);
    expect(v.term_quarters).toBe(9);
    // The call after the overrun spreads what remains (15,600) over the 8 calls left.
    expect(v.invested).toBe(2000 + 1950);
    expect(s.news.at(-1)!.text).toMatch(/over budget/);
    reconciles(s);
  });

  it("forfeits part of the stake when a call finds no cash, and calls no more", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    s.house.cash = 0;
    tick(s);
    stepVentures(s, neutral(), gameData);
    const v = s.ventures[0]!;
    expect(v.calls_stopped).toBe(true);
    expect(v.invested).toBe(1500);
    expect(remainingCommitment(v)).toBe(0);
    expect(s.house.cash).toBe(0);
    // The ledger records the cash entries the test skipped; only the ventures book is checked here.
    expect(accountBalance(s, "ventures")).toBe(ventureBook(s));
    run(s, 10);
    expect(s.house.cash).toBeGreaterThanOrEqual(0);
    expect(s.ventures[0]!.calls_paid).toBe(1);
  });

  it("loses the stake on failure, less a small salvage", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    const cash = s.house.cash;
    tick(s);
    stepVentures(s, fixedRng(0), gameData);
    expect(s.ventures[0]!.status).toBe("failed");
    expect(s.house.cash).toBe(cash + 200);
    expect(ventureBook(s)).toBe(0);
    reconciles(s);
  });

  it("goes on after the head dies mid-build, judged by the new head", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    run(s, 3);
    const head = s.people.find((p) => p.is_head)!;
    head.death_year = s.world.year;
    head.is_head = false;
    const heir = s.people.find((p) => p.role === "line" && p.death_year === null && !p.is_head)!;
    heir.is_head = true;
    heir.acumen = 1;
    expect(buildFailureChance(s, type("mill"), gameData)).toBeGreaterThan(quarterlyFailureRisk(type("mill")));
    run(s, 5);
    expect(s.ventures[0]).toMatchObject({ status: "active", phase: "running", invested: 16000 });
  });
});

describe("running and floating", () => {
  it("runs once built, pays year-end dividends, then floats: the stake becomes shares", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    run(s, 8);
    const v = s.ventures[0]!;
    expect(v.phase).toBe("running");
    // Calm, neutral draws: 16,000 * 12% / 4 * (textile driver, cloth at its fair-quarter price) a quarter.
    expect(v.earnings.length).toBe(1);
    const cashBefore = s.house.cash;
    const worth = netWorth(s);
    run(s, 5); // through the year end
    expect(s.ledger.some((e) => e.category === "venture_dividend")).toBe(true);
    expect(s.house.cash).toBeGreaterThan(cashBefore);
    // Proven after six running quarters with four of earnings above 4% of the stake: it floats.
    expect(v.status).toBe("listed");
    const c = s.markets.companies.find((x) => x.id === v.company)!;
    expect(c).toMatchObject({ name: "Main Valley Spinning Mill", status: "listed", sector: "textiles", par: 250 });
    expect(s.markets.shares[c.id]).toBe(64);
    expect(c.shares).toBe(128);
    expect(ventureBook(s)).toBe(0);
    expect(sharesBook(s)).toBe(Math.round(64 * c.price));
    expect(netWorth(s)).toBeGreaterThan(worth);
    reconciles(s);
  });

  it("opens a great work's sections as it is built, earning before it is finished, and floats after the first", () => {
    const s = fresh();
    s.world.year = 1836;
    const s1 = applyOk(s, invest("railway", 150000));
    run(s1, 11);
    expect(s1.ventures[0]!.sections_open).toBe(0);
    expect(s1.ventures[0]!.earnings).toEqual([]);
    run(s1, 1); // the twelfth quarter opens the first of five sections
    const v = s1.ventures[0]!;
    expect(v.sections_open).toBe(1);
    expect(v.earnings.length).toBe(1);
    expect(v.phase).toBe("building");
    run(s1, 3);
    expect(v.status).toBe("listed");
    const c = s1.markets.companies.find((x) => x.id === v.company)!;
    expect(c.earning_capital).not.toBeNull();
    const held = s1.markets.shares[c.id]!;
    // The next yearly call buys new shares at par.
    run(s1, 4);
    expect(s1.markets.shares[c.id]).toBe(held + 40);
    reconciles(s1);
  });
});

describe("selling a stake", () => {
  it("sells an unlisted stake privately at a heavy discount, with no more calls", () => {
    const s0 = applyOk(fresh(), invest("mill", 16000));
    run(s0, 4);
    const s = applyOk(s0, { kind: "sell_venture", venture: 1 });
    expect(s.house.cash).toBe(s0.house.cash + stakeSalePrice(8000, tuning));
    expect(stakeSalePrice(8000, tuning)).toBe(4800);
    expect(s.ventures[0]).toMatchObject({ status: "sold", invested: 0, calls_stopped: true });
    expect(accountBalance(s, "ventures")).toBe(0);
  });

  it("refuses a listed, failed or unknown stake", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    expect(applyDecision(s, { kind: "sell_venture", venture: 9 }, gameData)).toMatchObject({ ok: false });
    s.ventures[0]!.status = "listed";
    expect(applyDecision(s, { kind: "sell_venture", venture: 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/listed/) });
  });

  it("forced sales take unlisted stakes last, at no less than the private discount, and scale the calls left", () => {
    const s = applyOk(fresh(), invest("mill", 16000));
    run(s, 4); // 8,000 paid in, 8,000 to come
    s.house.cash = 0;
    expect(ventureSalePrice(1000, tuning)).toBe(600);
    const raised = raiseCash(s, 2400, tuning);
    expect(raised).toBe(2400);
    const v = s.ventures[0]!;
    expect(v.invested).toBe(4000);
    expect(remainingCommitment(v)).toBe(4000);
    expect(accountBalance(s, "ventures")).toBe(ventureBook(s));
  });
});

describe("through End Turn", () => {
  it("draws venture rolls from the markets' own stream, leaving the run's RNG alone", () => {
    const draws = (s: GameState) => {
      let n = 0;
      const rng = { next: () => (n++, 0.999999) };
      return { state: endTurn(s, [], rng, quiet), n };
    };
    const s0 = applyOk(fresh(), invest("mill", 16000), quiet);
    const withVenture = draws(s0);
    expect(withVenture.n).toBe(draws(fresh()).n);
    expect(withVenture.state.markets.rng_state).not.toBe(s0.markets.rng_state);
    reconciles(withVenture.state);
  });

  it("reconciles every account over forty quarters with ventures of every tier", () => {
    let s = fresh();
    s.house.cash = 1_000_000;
    s.ledger.push({ id: s.next_ledger_id++, turn: 1, account: "cash", category: "opening", amount: 900_000, note: "Test cash" });
    s = endTurn(s, [invest("mill", 40000), invest("brewery", 8000), invest("shipping", 60000)], noDefaults, quiet);
    for (let i = 0; i < 40; i++) s = endTurn(s, [], noDefaults, quiet);
    reconciles(s);
  });
});
