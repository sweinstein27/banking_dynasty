import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { loanSalePrice, raiseCash, resolveWithdrawals } from "../src/sim/liquidity";
import { lend } from "../src/sim/loans";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { GameState, LendDecision } from "../src/sim/types";
import { noDefaults } from "./helpers";

const tuning = gameData.tuning;
const panicShare = tuning.sentiment.withdrawal_share.panic;
const lendGood = (amount: number): LendDecision => ({ kind: "lend", amount, rate: 0.06, tier: "good" });

/** A house with the given loans (oldest first), cash and deposits, in a panic. */
function house(opts: { cash: number; deposits: number; loans?: number[] }): GameState {
  let s = newGame(gameData);
  s.house.cash = 10_000_000;
  for (const amount of opts.loans ?? []) {
    const r = lend(s, lendGood(amount), gameData);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    s.actions_this_turn = 0;
  }
  s.house.cash = opts.cash;
  s.house.deposits = opts.deposits;
  s.world.sentiment = "panic";
  // Rebuild the opening balances so the ledger still reconciles after the test setup.
  s.ledger = s.ledger.filter((e) => e.account === "loans");
  s.ledger.push({ id: 0, turn: 1, account: "cash", category: "opening", amount: opts.cash, note: "test" });
  s.ledger.push({ id: 0, turn: 1, account: "deposits", category: "opening", amount: opts.deposits, note: "test" });
  return s;
}

function reconciles(s: GameState) {
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "loans")).toBe(loanBook(s));
  expect(accountBalance(s, "deposits")).toBe(s.house.deposits);
}

describe("panic withdrawals", () => {
  it("take the panic share of deposits each quarter", () => {
    const s = house({ cash: 100000, deposits: 50000 });
    const out = resolveWithdrawals(s, tuning);
    expect(out).toEqual({ demanded: Math.round(50000 * panicShare), raised: 0, bankrupt: false });
    expect(s.house.deposits).toBe(50000 - out.demanded);
  });

  it("are paid from cash alone when cash covers them, selling nothing", () => {
    const s = house({ cash: 100000, deposits: 50000, loans: [20000] });
    resolveWithdrawals(s, tuning);
    expect(s.loans[0]!.status).toBe("active");
    expect(s.ledger.some((e) => e.category === "forced_sale")).toBe(false);
  });

  it("do nothing with zero deposits", () => {
    const s = house({ cash: 0, deposits: 0, loans: [20000] });
    expect(resolveWithdrawals(s, tuning)).toEqual({ demanded: 0, raised: 0, bankrupt: false });
    expect(s.house.status).toBe("solvent");
  });
});

describe("forced sales", () => {
  it("price a loan at the discount, in whole gulden", () => {
    expect(loanSalePrice(10000, tuning)).toBe(Math.round(10000 * (1 - tuning.forced_sale.loan_discount)));
    expect(Number.isInteger(loanSalePrice(12345, tuning))).toBe(true);
  });

  it("cover a shortfall by selling loans, oldest first, and only as many as needed", () => {
    // Demand 10,000; cash 2,000; shortfall 8,000. The first 20,000 loan alone covers it.
    const s = house({ cash: 2000, deposits: 50000, loans: [20000, 30000] });
    const out = resolveWithdrawals(s, tuning);
    expect(out.bankrupt).toBe(false);
    expect(out.raised).toBe(loanSalePrice(20000, tuning));
    expect(s.loans.map((l) => l.status)).toEqual(["sold", "active"]);
    expect(s.house.deposits).toBe(40000);
    expect(s.house.cash).toBe(2000 + loanSalePrice(20000, tuning) - 10000);
  });

  it("sell several loans when one is not enough", () => {
    // Demand 10,000 with no cash: one 10,000 loan fetches 7,000, two fetch 14,000.
    const s = house({ cash: 0, deposits: 50000, loans: [10000, 10000, 10000] });
    resolveWithdrawals(s, tuning);
    expect(s.loans.map((l) => l.status)).toEqual(["sold", "sold", "active"]);
    expect(s.house.status).toBe("solvent");
  });

  it("skip loans that are not active", () => {
    const s = house({ cash: 0, deposits: 50000, loans: [20000, 20000] });
    s.loans[0]!.status = "defaulted";
    const raised = raiseCash(s, 1, tuning);
    expect(raised).toBe(loanSalePrice(20000, tuning));
    expect(s.loans[1]!.status).toBe("sold");
  });

  it("lose exactly the discount from net worth, and reconcile", () => {
    const s = house({ cash: 0, deposits: 50000, loans: [20000] });
    const before = netWorth(s);
    resolveWithdrawals(s, tuning);
    expect(netWorth(s)).toBe(before - (20000 - loanSalePrice(20000, tuning)));
    reconciles(s);
  });

  it("draw on the reserve before selling anything", () => {
    const s = house({ cash: 10000, deposits: 50000, loans: [20000] });
    s.house.reserve = 10000;
    resolveWithdrawals(s, tuning);
    expect(s.loans[0]!.status).toBe("active");
    expect(s.house.cash).toBe(0);
  });
});

describe("bankruptcy", () => {
  it("happens when selling everything cannot pay depositors", () => {
    // Demand 20,000; cash 1,000 + one 10,000 loan sold for 7,000 = 8,000.
    const s = house({ cash: 1000, deposits: 100000, loans: [10000] });
    const out = resolveWithdrawals(s, tuning);
    expect(out.bankrupt).toBe(true);
    expect(s.house.status).toBe("bankrupt");
    expect(s.house.cash).toBe(0);
    expect(s.loans[0]!.status).toBe("sold");
    reconciles(s);
  });

  it("happens with zero cash and nothing to sell", () => {
    const s = house({ cash: 0, deposits: 50000 });
    expect(resolveWithdrawals(s, tuning).bankrupt).toBe(true);
  });

  it("can happen when merely uneasy, if there is nothing at all to pay with", () => {
    const s = house({ cash: 0, deposits: 50000 });
    s.world.sentiment = "uneasy";
    expect(resolveWithdrawals(s, tuning).bankrupt).toBe(true);
  });

  it("is not triggered by a shortfall the sales cover exactly", () => {
    // Demand 10,000; cash 3,000; one 10,000 loan sells for exactly 7,000.
    const s = house({ cash: 3000, deposits: 50000, loans: [10000] });
    expect(loanSalePrice(10000, tuning)).toBe(7000);
    const out = resolveWithdrawals(s, tuning);
    expect(out.bankrupt).toBe(false);
    expect(s.house.cash).toBe(0);
  });

  it("ends the run: End Turn refuses to play on and no decisions are accepted", () => {
    const s0 = house({ cash: 0, deposits: 50000 });
    const s1 = endTurn(s0, [], noDefaults, gameData);
    expect(s1.house.status).toBe("bankrupt");
    expect(() => endTurn(s1, [], noDefaults, gameData)).toThrow(/bankrupt/);
    const r = applyDecision(s1, { kind: "set_reserve", amount: 5000 }, gameData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/bankrupt/);
  });

  it("is avoided in End Turn when this quarter's repayments arrive before withdrawals", () => {
    // A loan repaid this quarter adds cash before withdrawals, which can save the house.
    let s = house({ cash: 0, deposits: 50000, loans: [20000] });
    s.world.turn = s.loans[0]!.start_turn + tuning.loans.term_quarters - 1;
    s = endTurn(s, [], noDefaults, gameData);
    expect(s.loans[0]!.status).toBe("repaid");
    expect(s.house.status).toBe("solvent");
  });
});
