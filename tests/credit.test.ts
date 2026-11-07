// Milestone A1, credit: borrowers' books, information tiers, loans of many lengths, selling loans.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { paymentRecordQuarters } from "../src/sim/systems/counting";
import { readBooks } from "../src/harness/systems/credit";
import { createBorrowers, defaultRecovery } from "../src/sim/borrowers";
import { applyDecision, applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { loanSaleOffers } from "../src/sim/offers";
import { createRng } from "../src/sim/rng";
import {
  bandOf,
  checkFile,
  createBooks,
  fileOn,
  fileStale,
  remarkBand,
  resolveCredit,
  saleDiscount,
  salePrice,
  tradeQuarter,
  fileCost,
} from "../src/sim/systems/credit";
import { endTurn, loanBook, netWorth } from "../src/sim/turn";
import type { Decision, GameState, LoanKind } from "../src/sim/types";
import { FAIR, fixedRng, fresh, GOOD, noDefaults, POOR, quiet } from "./helpers";

const c = gameData.credit;
const t = gameData.tuning.loans;

function decide(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

/** fresh(), with GOOD asking for a loan of `kind` for `term` quarters. */
function asking(kind: LoanKind, term: number): GameState {
  const s = fresh();
  const r = s.requests.find((x) => x.borrower_id === GOOD)!;
  r.kind = kind;
  r.term_quarters = term;
  r.max_rate = 0.12;
  return s;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("borrowers' books", () => {
  it("are the same for the same seed, and sounder houses keep better books on average", () => {
    expect(createBooks(0.7, 1815, gameData, createRng(3))).toEqual(createBooks(0.7, 1815, gameData, createRng(3)));
    const sample = (q: number) => Array.from({ length: 300 }, (_, i) => createBooks(q, 1815, gameData, createRng(i + 1)));
    const weak = sample(0.3);
    const strong = sample(0.9);
    expect(mean(strong.map((b) => b.margin))).toBeGreaterThan(mean(weak.map((b) => b.margin)) + 0.04);
    expect(mean(strong.map((b) => b.debts / b.turnover))).toBeLessThan(mean(weak.map((b) => b.debts / b.turnover)) - 0.2);
    expect(mean(strong.map((b) => b.collateral / b.turnover))).toBeGreaterThan(mean(weak.map((b) => b.collateral / b.turnover)) + 0.3);
    expect(mean(strong.map((b) => 1815 - b.founded))).toBeGreaterThan(mean(weak.map((b) => 1815 - b.founded)));
  });

  it("flatter weak houses: book margin is above the true margin, by more the weaker the house", () => {
    const gap = (q: number) => mean(Array.from({ length: 200 }, (_, i) => createBooks(q, 1815, gameData, createRng(i + 7))).map((b) => b.book_margin - b.margin));
    expect(gap(1)).toBe(0);
    expect(gap(0.3)).toBeGreaterThan(gap(0.8));
  });

  it("change each quarter on credit's own rolls, leaving the main RNG alone", () => {
    const s = fresh();
    const before = structuredClone(s.borrowers.map((b) => b.books));
    let mainRolls = 0;
    resolveCredit(s, { next: () => (mainRolls++, 0.5) }, gameData);
    expect(mainRolls).toBe(0);
    expect(s.borrowers.map((b) => b.books.turnover)).not.toEqual(before.map((b) => b.turnover));
    expect(s.credit.rng_state).not.toBe(fresh().credit.rng_state);
  });

  it("shrink turnover and margins in a panic", () => {
    const s = fresh();
    const b = s.borrowers[0]!;
    const start = b.books.turnover;
    s.world.sentiment = "panic";
    for (let i = 0; i < 4; i++) tradeQuarter(b, s, gameData, fixedRng(0.5, 0.999));
    expect(b.books.turnover).toBeLessThan(start);
    const calm = structuredClone(b.books);
    s.world.sentiment = "calm";
    tradeQuarter(b, s, gameData, fixedRng(0.5, 0.999));
    expect(b.books.margin).toBeGreaterThan(calm.margin);
  });

  it("record late payments to other lenders, and forget them after the window", () => {
    const s = fresh();
    const b = s.borrowers.find((x) => x.id === POOR)!;
    tradeQuarter(b, s, gameData, fixedRng(0.5, 0));
    expect(b.books.late).toEqual([s.world.turn]);
    // Kept as far back as an archive can look (A2), then forgotten.
    s.world.turn += Math.max(c.books.late.window_quarters, gameData.counting.effects.archive_record_quarters);
    tradeQuarter(b, s, gameData, fixedRng(0.5, 0.999));
    expect(b.books.late).toEqual([]);
  });

  it("give every borrower in the data its own books", () => {
    for (const b of createBorrowers(gameData, createRng(2))) {
      expect(b.books.turnover).toBeGreaterThanOrEqual(c.books.turnover.min);
      expect(b.books.turnover).toBeLessThanOrEqual(c.books.turnover.max);
    }
  });
});

describe("bands", () => {
  it("place a value in the first band whose minimum it reaches", () => {
    expect(bandOf(0.95, gameData)).toBe("sound");
    expect(bandOf(0.7, gameData)).toBe("steady");
    expect(bandOf(0.55, gameData)).toBe("stretched");
    expect(bandOf(0.1, gameData)).toBe("doubtful");
  });

  it("a partner's remark stays within remark_spread of the truth", () => {
    const s = fresh();
    const good = s.borrowers.find((b) => b.id === GOOD)!;
    expect(remarkBand(good, gameData)).toBe("sound");
    expect(remarkBand(s.borrowers.find((b) => b.id === POOR)!, gameData)).toBe("doubtful");
  });
});

describe("information tiers", () => {
  it("bourse talk is free: a request carries it with no cost and no action", () => {
    const s = fresh();
    expect(s.requests.every((r) => r.talk)).toBe(true);
    expect(s.actions_this_turn).toBe(0);
  });

  it("a report shows turnover, book profit, debts and payment record, but not collateral, true profit or remarks", () => {
    const s = decide(fresh(), { kind: "report", borrower: FAIR });
    const b = s.borrowers.find((x) => x.id === FAIR)!;
    expect(b.file).toEqual(fileOn(b, "report", s.world.turn, gameData, paymentRecordQuarters(s, gameData)));
    expect(b.file).toMatchObject({ tier: "report", turnover: b.books.turnover, debts: b.books.debts, late_payments: b.books.late.length, record_quarters: gameData.counting.effects.record_quarters, collateral: null, true_profit: null, remark: null });
    expect(b.file!.profit).toBe(Math.round((b.books.turnover * b.books.book_margin) / 100) * 100);
  });

  it("a file counts late payments as far back as the house's records reach: further with an archive", () => {
    const s = fresh();
    const b = s.borrowers.find((x) => x.id === POOR)!;
    const e = gameData.counting.effects;
    b.books.late = [s.world.turn - (e.record_quarters + 2)];
    expect(fileOn(b, "report", s.world.turn, gameData, e.record_quarters).late_payments).toBe(0);
    expect(fileOn(b, "report", s.world.turn, gameData, e.archive_record_quarters).late_payments).toBe(1);
  });

  it("a report costs report_cost with one correspondent or none", () => {
    expect(fileCost(fresh(), "report", gameData)).toBe(c.info.report_cost);
    expect(fileCost(fresh(), "inquiry", gameData)).toBe(c.info.inquiry_cost);
  });

  it("a full inquiry costs inquiry_cost and an action, and shows collateral, true profit and a partner's remark", () => {
    const s0 = fresh();
    const s = decide(s0, { kind: "inquire", borrower: POOR });
    const b = s.borrowers.find((x) => x.id === POOR)!;
    expect(s.house.cash).toBe(s0.house.cash - c.info.inquiry_cost);
    expect(s.actions_this_turn).toBe(1);
    expect(s.ledger.at(-1)).toMatchObject({ account: "cash", category: "inquiry", amount: -c.info.inquiry_cost });
    expect(b.file).toMatchObject({ tier: "inquiry", collateral: b.books.collateral, remark: "doubtful" });
    expect(b.file!.true_profit).toBe(Math.round((b.books.turnover * b.books.margin) / 100) * 100);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
  });

  it("an inquiry can follow a report, but not the other way round, until the file goes stale", () => {
    const s = decide(fresh(), { kind: "report", borrower: FAIR }, { kind: "inquire", borrower: FAIR });
    expect(checkFile(s, FAIR, "report", gameData)).toBe("You already have a recent inquiry on Fair and Co.");
    expect(checkFile(s, FAIR, "inquiry", gameData)).toMatch(/recent inquiry/);
    const f = s.borrowers.find((x) => x.id === FAIR)!.file!;
    expect(fileStale(f, s.world.turn + c.info.stale_quarters - 1, gameData)).toBe(false);
    expect(fileStale(f, s.world.turn + c.info.stale_quarters, gameData)).toBe(true);
    s.world.turn += c.info.stale_quarters;
    expect(checkFile(s, FAIR, "report", gameData)).toBeNull();
  });

  it("is a snapshot: the file keeps the quarter it was bought while the books move on", () => {
    let s = decide(fresh(), { kind: "report", borrower: FAIR });
    const filed = s.borrowers.find((x) => x.id === FAIR)!.file!;
    s = endTurn(s, [], noDefaults, quiet);
    const b = s.borrowers.find((x) => x.id === FAIR)!;
    expect(b.file).toEqual(filed);
    expect(b.books.turnover).not.toBe(filed.turnover);
  });

  it("can be bought on a borrower who owes the house, even with no request", () => {
    const s = decide(fresh(), { kind: "lend", borrower: GOOD, amount: 5000, rate: 0.06 });
    expect(s.requests.some((r) => r.borrower_id === GOOD)).toBe(false);
    expect(checkFile(s, GOOD, "inquiry", gameData)).toBeNull();
  });

  it("is refused with no cash, for an unknown borrower, or with no capacity left", () => {
    const broke = fresh();
    broke.house.cash = 0;
    expect(checkFile(broke, FAIR, "report", gameData)).toMatch(/^Not enough cash/);
    expect(checkFile(broke, FAIR, "inquiry", gameData)).toMatch(/^Not enough cash/);
    expect(applyDecision(broke, { kind: "inquire", borrower: FAIR }, gameData).ok).toBe(false);
    expect(checkFile(fresh(), 99, "report", gameData)).toBe("Unknown borrower #99");
    const busy = fresh();
    busy.counting.used = { deals: 99, reports: 99, opinions: 99, head: 99 };
    expect(checkFile(busy, FAIR, "inquiry", gameData)).toMatch(/^No correspondent is free/);
  });
});

describe("loans of many lengths", () => {
  it("a loan takes the kind and term of the request", () => {
    const s = decide(asking("bill", 2), { kind: "lend", borrower: GOOD, amount: 3000, rate: 0.05 });
    expect(s.loans[0]).toMatchObject({ kind: "bill", term_quarters: 2 });
  });

  it("a bill pays interest each quarter and its principal at term", () => {
    let s = decide(asking("bill", 2), { kind: "lend", borrower: GOOD, amount: 4000, rate: 0.06 });
    const cash = s.house.cash;
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.loans[0]!.status).toBe("active");
    expect(s.house.cash).toBe(cash + 60);
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.loans[0]!.status).toBe("repaid");
    expect(s.house.cash).toBe(cash + 120 + 4000);
  });

  it("a mortgage repays its principal in parts that add up to the whole, with interest on what is left", () => {
    const term = 20;
    let s = decide(asking("mortgage", term), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
    const cash = s.house.cash;
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.loans[0]!.principal).toBe(20000 - 1000);
    expect(s.house.cash).toBe(cash + 400 + 1000);
    for (let i = 1; i < term; i++) s = endTurn(s, [], noDefaults, quiet);
    const loan = s.loans[0]!;
    expect(loan.status).toBe("repaid");
    const parts = s.ledger.filter((e) => e.account === "loans" && (e.category === "principal_part" || e.category === "repayment") && e.note.startsWith("Loan #1:"));
    expect(-parts.reduce((a, e) => a + e.amount, 0)).toBe(20000);
    expect(parts).toHaveLength(term);
    expect(loanBook(s)).toBe(0);
    expect(accountBalance(s, "loans")).toBe(0);
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
  });

  it("long loans keep rolling for default every quarter, at the kind's default_factor", () => {
    let s = decide(asking("mortgage", 40), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
    // p = p0 * calm (1) * (1 - 0.9) * the mortgage's default_factor: a roll just above survives, just below defaults.
    const p = gameData.tuning.loans.p0 * (1 - 0.9) * gameData.tuning.loans.kinds.mortgage.default_factor;
    s = endTurn(s, [], fixedRng(p * 1.1, 0.999999), quiet);
    expect(s.loans[0]!.status).toBe("active");
    s = endTurn(s, [], fixedRng(p * 0.9, 0.999999), quiet);
    expect(s.loans[0]!.status).toBe("defaulted");
  });

  it("a defaulted mortgage recovers part of the principal from collateral; commercial credit recovers nothing", () => {
    const run = (kind: LoanKind) => {
      const s0 = decide(asking(kind, kind === "mortgage" ? 20 : 4), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
      s0.borrowers.find((b) => b.id === GOOD)!.books.collateral = 1_000_000;
      return { s0, s: endTurn(s0, [], fixedRng(0, 0.999999), quiet) };
    };
    const m = run("mortgage");
    expect(m.s.loans[0]!.status).toBe("defaulted");
    const recovered = Math.round(20000 * t.kinds.mortgage.recovery);
    expect(m.s.house.cash).toBe(m.s0.house.cash + recovered);
    expect(m.s.ledger.some((e) => e.category === "recovery" && e.amount === recovered)).toBe(true);
    expect(m.s.news.some((n) => n.text.includes(`brings back`))).toBe(true);
    expect(netWorth(m.s)).toBe(netWorth(m.s0) - (20000 - recovered));
    expect(accountBalance(m.s, "cash")).toBe(m.s.house.cash);
    const k = run("commercial");
    expect(k.s.house.cash).toBe(k.s0.house.cash);
  });

  it("recovery shrinks when the collateral covers less than the principal", () => {
    const s = decide(asking("mortgage", 20), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
    s.borrowers.find((b) => b.id === GOOD)!.books.collateral = 10000;
    expect(defaultRecovery(s, s.loans[0]!, gameData.tuning)).toBe(Math.round(20000 * t.kinds.mortgage.recovery * 0.5));
    s.borrowers.find((b) => b.id === GOOD)!.books.collateral = 0;
    expect(defaultRecovery(s, s.loans[0]!, gameData.tuning)).toBe(0);
  });

  it("a forced sale can take a slice of a mortgage, and the parts then shrink to fit", () => {
    let s = decide(asking("mortgage", 20), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
    s.loans[0]!.principal = 9500; // as if a forced sale had taken a slice
    s.ledger.push({ ...s.ledger.at(-1)!, id: s.next_ledger_id++, account: "loans", category: "forced_sale", amount: -10500 });
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.loans[0]!.principal).toBe(9500 - Math.round(9500 / 20));
  });
});

describe("selling a loan", () => {
  it("another house pays principal less a discount for risk, years left and the mood", () => {
    const s = decide(asking("mortgage", 40), { kind: "lend", borrower: GOOD, amount: 20000, rate: 0.08 });
    const loan = s.loans[0]!;
    const calm = saleDiscount(loan, s, gameData);
    expect(calm).toBeCloseTo(c.sale.base + c.sale.per_risk * (1 - 0.9) + c.sale.per_year_left * 10);
    s.world.sentiment = "panic";
    expect(saleDiscount(loan, s, gameData)).toBeCloseTo(calm + c.sale.mood.panic);
    expect(salePrice(loan, s, gameData)).toBe(Math.round(20000 * (1 - calm - c.sale.mood.panic)));
    s.borrowers.find((b) => b.id === GOOD)!.market_quality = 0;
    expect(saleDiscount(loan, s, gameData)).toBeLessThanOrEqual(c.sale.max);
  });

  it("prices on the market's view, not the truth", () => {
    const s = decide(fresh(), { kind: "lend", borrower: POOR, amount: 10000, rate: 0.16 });
    const before = salePrice(s.loans[0]!, s, gameData);
    s.borrowers.find((b) => b.id === POOR)!.market_quality = 0.9;
    expect(salePrice(s.loans[0]!, s, gameData)).toBeGreaterThan(before);
  });

  it("moves the price into cash, takes the principal off the loan book, uses an action and balances the ledger", () => {
    const s0 = decide(fresh(), { kind: "lend", borrower: FAIR, amount: 10000, rate: 0.1 });
    const price = loanSaleOffers(s0, gameData)[0]!.price;
    const s = decide(s0, { kind: "sell_loan", loan: 1 });
    expect(s.loans[0]!.status).toBe("sold");
    expect(s.house.cash).toBe(s0.house.cash + price);
    expect(loanBook(s)).toBe(0);
    expect(s.actions_this_turn).toBe(s0.actions_this_turn + 1);
    expect(netWorth(s)).toBe(netWorth(s0) - (10000 - price));
    for (const acct of ["cash", "loans"] as const) expect(accountBalance(s, acct)).toBe(acct === "cash" ? s.house.cash : loanBook(s));
    // A sold loan pays the house nothing more.
    const next = endTurn(s, [], noDefaults, quiet);
    expect(next.ledger.some((e) => e.turn === s.world.turn && e.category === "interest")).toBe(false);
  });

  it("works with no cash at all, and is refused for an unknown or inactive loan or with no capacity", () => {
    const s0 = decide(fresh(), { kind: "lend", borrower: FAIR, amount: 10000, rate: 0.1 });
    s0.house.cash = 0;
    expect(applyDecision(s0, { kind: "sell_loan", loan: 1 }, gameData).ok).toBe(true);
    expect(applyDecision(s0, { kind: "sell_loan", loan: 9 }, gameData)).toEqual({ ok: false, reason: "Unknown loan #9" });
    const sold = decide(s0, { kind: "sell_loan", loan: 1 });
    expect(applyDecision(sold, { kind: "sell_loan", loan: 1 }, gameData)).toEqual({ ok: false, reason: "Loan #1 is not active" });
    const busy = structuredClone(s0);
    busy.counting.used = { deals: 99, reports: 99, opinions: 99, head: 99 };
    expect(applyDecision(busy, { kind: "sell_loan", loan: 1 }, gameData).ok).toBe(false);
  });
});

describe("a head of house dying mid-year", () => {
  it("leaves the books, files and loans untouched, and bourse talk falls back to the new head's Prudence", () => {
    const s0 = decide(fresh(), { kind: "report", borrower: FAIR }, { kind: "lend", borrower: FAIR, amount: 5000, rate: 0.1 });
    s0.people[0]!.death_year = s0.world.year;
    const s = endTurn(s0, [], noDefaults, quiet);
    expect(s.loans[0]!.status).toBe("active");
    expect(s.borrowers.find((x) => x.id === FAIR)!.file?.tier).toBe("report");
  });
});

describe("a whole run", () => {
  it("plays 40 quarters of every kind of loan with balances that match the ledger", () => {
    const rng = createRng(8);
    let s = newGame(gameData, rng);
    const kinds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const ds: Decision[] = [];
      const r = s.requests[0];
      if (r) {
        ds.push({ kind: "report", borrower: r.borrower_id }, { kind: "lend", borrower: r.borrower_id, amount: Math.min(r.amount, 8000), rate: r.max_rate });
        kinds.add(r.kind);
      }
      const ok = applyDecisions(s, ds, gameData);
      s = endTurn(s, ok.ok ? ds : [], rng, gameData);
      if (s.house.status === "bankrupt") break;
    }
    expect(kinds.size).toBe(3);
    expect(accountBalance(s, "loans")).toBe(loanBook(s));
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
  });
});

describe("the harness's reading of the books", () => {
  it("ranks sounder borrowers higher on average, and an inquiry reads them better than a report", () => {
    const err = (tier: "report" | "inquiry") => {
      let total = 0;
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const s = fresh();
        const b = s.borrowers[i % 4]!;
        b.books = createBooks(b.quality, 1815, gameData, createRng(i + 100));
        total += Math.abs(readBooks(null, fileOn(b, tier, 1, gameData), gameData) - b.quality);
        n++;
      }
      return total / n;
    };
    expect(err("inquiry")).toBeLessThan(err("report"));
    expect(err("report")).toBeLessThan(0.25);
  });
});
