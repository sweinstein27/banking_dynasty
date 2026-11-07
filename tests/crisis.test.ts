import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { checkCrisis, debtBook, debtInterest, inCrisis, lenders, lendingTerms } from "../src/sim/crisis";
import { createHouses } from "../src/sim/houses";
import { applyDecisions } from "../src/sim/decisions";
import { accountBalance } from "../src/sim/ledger";
import { parseSave, toSave } from "../src/sim/save";
import { withdrawalDemand } from "../src/sim/sentiment";
import { endTurn, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LedgerAccount, Sentiment } from "../src/sim/types";
import { FAIR, fresh, GOOD, noDefaults, quiet } from "./helpers";

const { tuning } = gameData;
const c = tuning.crisis;

/** A test game in `sentiment`, with the real houses (so there is someone to borrow from). */
function inMood(sentiment: Sentiment): GameState {
  const s = fresh();
  s.houses = createHouses(gameData);
  s.world.sentiment = sentiment;
  return s;
}

function decide(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reconciles(s: GameState) {
  for (const account of ["cash", "deposits", "borrowings"] as LedgerAccount[]) {
    const balance = account === "cash" ? s.house.cash : account === "deposits" ? s.house.deposits : debtBook(s);
    expect(accountBalance(s, account), account).toBe(balance);
  }
}

describe("when crisis measures are open", () => {
  it("only while uneasy, panicking, or under a panic warning", () => {
    expect(inCrisis(inMood("calm"))).toBe(false);
    expect(inCrisis(inMood("uneasy"))).toBe(true);
    expect(inCrisis(inMood("panic"))).toBe(true);
    const warned = inMood("calm");
    warned.panic_warning = { turns_left: 2 };
    expect(inCrisis(warned)).toBe(true);
  });

  it("refuses every measure in a calm market", () => {
    for (const d of [{ kind: "borrow", house: "albrecht", amount: 10000 }, { kind: "pay_slowly" }, { kind: "suspend" }] as Decision[]) {
      expect(checkCrisis(inMood("calm"), d as never, tuning)).toMatch(/only open while the market is uneasy/);
    }
  });

  it("borrowing uses the head's time; suspending uses none (A2)", () => {
    let s = inMood("panic");
    s = decide(s, { kind: "borrow", house: "albrecht", amount: 10000 }, { kind: "suspend" }, { kind: "borrow", house: "albrecht", amount: 10000 });
    expect(s.actions_this_turn).toBe(tuning.capacity.head);
    expect(checkCrisis(s, { kind: "borrow", house: "albrecht", amount: 10000 }, tuning)).toMatch(/The head has no time left/);
  });
});

describe("borrowing from another house", () => {
  it("adds cash and a debt of the same size, leaving net worth unchanged, at a reputation cost", () => {
    const s0 = inMood("uneasy");
    const s = decide(s0, { kind: "borrow", house: "albrecht", amount: 20000 });
    expect(s.house.cash).toBe(s0.house.cash + 20000);
    expect(debtBook(s)).toBe(20000);
    expect(netWorth(s)).toBe(netWorth(s0));
    expect(s.house.reputation).toBe(s0.house.reputation - c.lending.reputation_cost);
    expect(s.debts[0]).toMatchObject({ lender: "Bankhaus Albrecht", house: "albrecht", principal: 20000, rate: c.lending.base_rate, start_turn: 1, term_quarters: c.lending.term_quarters, status: "active" });
    reconciles(s);
  });

  it("refuses too little, fractions, or more than the houses will lend in all", () => {
    const s = inMood("panic");
    expect(checkCrisis(s, { kind: "borrow", house: "albrecht", amount: c.lending.min_amount - 1 }, tuning)).toMatch(/at least/);
    expect(checkCrisis(s, { kind: "borrow", house: "albrecht", amount: 10000.5 }, tuning)).toMatch(/whole/);
    const owing = decide(s, { kind: "borrow", house: "albrecht", amount: c.lending.max_outstanding - 5000 });
    expect(checkCrisis(owing, { kind: "borrow", house: "albrecht", amount: 5001 }, tuning)).toMatch(/will lend at most 5,000\sfl\./);
    expect(checkCrisis(owing, { kind: "borrow", house: "albrecht", amount: 5000 }, tuning)).toBeNull();
  });

  it("pays interest every quarter and repays at the end of the term", () => {
    let s = decide(inMood("uneasy"), { kind: "borrow", house: "albrecht", amount: 20000 });
    s.world.sentiment = "calm";
    const interest = debtInterest({ principal: 20000, rate: c.lending.base_rate });
    const startCash = s.house.cash;
    for (let i = 0; i < c.lending.term_quarters; i++) s = endTurn(s, [], noDefaults, quiet);
    expect(s.debts[0]!.status).toBe("repaid");
    expect(debtBook(s)).toBe(0);
    expect(s.house.cash).toBe(startCash - 20000 - interest * c.lending.term_quarters);
    expect(s.ledger.filter((e) => e.category === "debt_interest")).toHaveLength(c.lending.term_quarters);
    reconciles(s);
    expect(s.news.some((n) => n.text === `You repaid 20,000 fl. to ${"Bankhaus Albrecht"}.`)).toBe(true);
  });

  it("sells assets to repay a debt that falls due, and goes bankrupt if even that fails", () => {
    let s = decide(inMood("uneasy"), { kind: "borrow", house: "albrecht", amount: 20000 });
    s.world.sentiment = "calm";
    s.world.turn += c.lending.term_quarters - 1; // due at the end of this turn
    s.house.cash = 0;
    s.house.deposits = 0;
    s.ledger = s.ledger.filter((e) => e.account === "borrowings");
    const broke = endTurn(s, [], noDefaults, quiet);
    expect(broke.house.status).toBe("bankrupt");
    expect(broke.news.some((n) => n.kind === "bankruptcy" && n.text.includes("could not meet its obligations"))).toBe(true);
  });
});

describe("paying slowly and suspending", () => {
  it("pay_slowly pays only a share of what depositors ask; the rest stays owed", () => {
    const s0 = inMood("panic");
    const asked = withdrawalDemand(s0.house.deposits, "panic", tuning, s0.house.reputation - c.pay_slowly.reputation_cost);
    const s = endTurn(s0, [{ kind: "pay_slowly" }], noDefaults, quiet);
    expect(s0.house.deposits - s.house.deposits).toBe(Math.round(asked * c.pay_slowly.share));
    expect(s.house.reputation).toBe(s0.house.reputation - c.pay_slowly.reputation_cost);
    expect(s.news.some((n) => n.kind === "crisis" && n.text.startsWith("You paid depositors only part"))).toBe(true);
  });

  it("suspend pays depositors nothing this quarter, at a heavy reputation cost", () => {
    const s0 = inMood("panic");
    const s = endTurn(s0, [{ kind: "suspend" }], noDefaults, quiet);
    expect(s.house.deposits).toBe(s0.house.deposits);
    expect(s.ledger.filter((e) => e.category === "withdrawal")).toEqual([]);
    expect(s.house.reputation).toBe(s0.house.reputation - c.suspend.reputation_cost);
  });

  it("only one payout limit per quarter, and the policy ends with the turn", () => {
    const s = decide(inMood("panic"), { kind: "suspend" });
    expect(checkCrisis(s, { kind: "pay_slowly" }, tuning)).toMatch(/already limited/);
    const next = endTurn(inMood("panic"), [{ kind: "suspend" }], noDefaults, quiet);
    expect(next.withdrawal_policy).toBe("normal");
  });

  it("can save a house that a bank run would otherwise bankrupt", () => {
    const doomed = () => {
      const s = inMood("panic");
      s.house.cash = 1000;
      s.house.deposits = 100000;
      s.ledger = [];
      return s;
    };
    expect(endTurn(doomed(), [], noDefaults, quiet).house.status).toBe("bankrupt");
    expect(endTurn(doomed(), [{ kind: "suspend" }], noDefaults, quiet).house.status).toBe("solvent");
  });
});

describe("calling a loan in", () => {
  it("recovers most of the principal at once and keeps the borrower away", () => {
    const lent = endTurn(decide(fresh(), { kind: "lend", borrower: FAIR, amount: 20000, rate: 0.1 }), [], noDefaults, quiet);
    lent.world.sentiment = "panic";
    const s = decide(lent, { kind: "call_loan", loan: 1 });
    const recovered = Math.round(20000 * c.call_loan.recovery);
    expect(s.loans[0]!.status).toBe("called");
    expect(s.house.cash).toBe(lent.house.cash + recovered);
    expect(netWorth(s)).toBe(netWorth(lent) - (20000 - recovered));
    expect(s.borrowers.find((b) => b.id === FAIR)!.away_until).toBe(s.world.turn + c.call_loan.absence_quarters);
    expect(accountBalance(s, "loans")).toBe(0);
    // In play the call is queued and resolved by End Turn, which writes the news.
    const after = endTurn(lent, [{ kind: "call_loan", loan: 1 }], noDefaults, quiet);
    expect(after.news.some((n) => n.kind === "crisis" && n.text.startsWith("You called in Fair and Co.'s loan of 20,000 fl. and recovered 18,000 fl."))).toBe(true);
  });

  it("refuses unknown or inactive loans", () => {
    const s = inMood("panic");
    expect(checkCrisis(s, { kind: "call_loan", loan: 9 }, tuning)).toBe("Unknown loan #9");
    const lent = decide(inMood("panic"), { kind: "lend", borrower: GOOD, amount: 5000, rate: 0.06 });
    const called = decide(lent, { kind: "call_loan", loan: 1 });
    expect(checkCrisis(called, { kind: "call_loan", loan: 1 }, tuning)).toBe("Loan #1 is not active");
  });
});

describe("saves with crisis state", () => {
  it("keep debts and the payout policy", () => {
    const s = decide(inMood("panic"), { kind: "borrow", house: "albrecht", amount: 10000 }, { kind: "pay_slowly" });
    const r = parseSave(toSave(fresh(), 1, 1, []), gameData);
    expect(r.ok).toBe(true);
    const queued = parseSave(toSave(inMood("panic"), 1, 1, [{ kind: "borrow", house: "albrecht", amount: 10000 }, { kind: "pay_slowly" }]), gameData);
    expect(queued.ok).toBe(true);
    const direct = parseSave(toSave(s, 1, 1, []), gameData);
    expect(direct.ok && direct.save.state.debts).toHaveLength(1);
    expect(direct.ok && direct.save.state.withdrawal_policy).toBe("slow");
  });
});
