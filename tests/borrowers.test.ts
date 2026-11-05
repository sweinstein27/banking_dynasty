import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { buyReport, checkReport, createBorrowers, drawRequests, estimateRange, estimateWidth, maxRate } from "../src/sim/borrowers";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { checkLend } from "../src/sim/loans";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { Borrower, Decision, GameState } from "../src/sim/types";
import { FAIR, fixedRng, fresh, GOOD, noDefaults, POOR, quiet } from "./helpers";

const { tuning } = gameData;
const t = tuning.loans;

function decide(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("createBorrowers", () => {
  it("draws one borrower per record, with true quality inside its range", () => {
    const bs = createBorrowers(gameData, createRng(9));
    expect(bs).toHaveLength(gameData.borrowers.length);
    bs.forEach((b, i) => {
      const [lo, hi] = gameData.borrowers[i]!.quality;
      expect(b).toMatchObject({ id: i + 1, name: gameData.borrowers[i]!.name, reported: false, repaid: 0, defaulted: 0, last_default_turn: null });
      expect(b.quality).toBeGreaterThanOrEqual(lo);
      expect(b.quality).toBeLessThanOrEqual(hi);
      expect(Math.abs(b.market_quality - b.quality)).toBeLessThanOrEqual(t.market.noise + 0.001);
      expect(Math.abs(b.estimate_noise)).toBeLessThanOrEqual(1);
    });
  });

  it("is the same for the same seed and differs between seeds", () => {
    expect(createBorrowers(gameData, createRng(9))).toEqual(createBorrowers(gameData, createRng(9)));
    expect(createBorrowers(gameData, createRng(9))).not.toEqual(createBorrowers(gameData, createRng(10)));
  });

  it("gives a new game its first quarter's requests", () => {
    const s = newGame(gameData, createRng(9));
    expect(s.requests).toHaveLength(t.requests_per_quarter);
  });
});

describe("maxRate", () => {
  it("is base + spread * (1 - market quality), to the nearest half percent", () => {
    expect(maxRate(1, tuning)).toBe(t.rate.base);
    expect(maxRate(0, tuning)).toBe(Math.round((t.rate.base + t.rate.spread) * 200) / 200);
    expect(maxRate(0.6, tuning)).toBe(0.095);
  });
});

describe("estimateRange", () => {
  const borrower = (quality: number, estimate_noise: number, reported = false): Borrower => ({
    id: 1, name: "X", trade: "x", quality, market_quality: quality, estimate_noise, reported, repaid: 0, defaulted: 0, last_default_turn: null, away_until: null,
  });

  it("always contains the true quality, whatever the noise", () => {
    for (const q of [0, 0.05, 0.3, 0.5, 0.77, 0.95, 1]) {
      for (const n of [-1, -0.6, 0, 0.3, 1]) {
        for (const reported of [false, true]) {
          const r = estimateRange(borrower(q, n, reported), tuning);
          expect(r.low, `${q} ${n}`).toBeLessThanOrEqual(q);
          expect(r.high, `${q} ${n}`).toBeGreaterThanOrEqual(q);
          expect(r.low).toBeGreaterThanOrEqual(0);
          expect(r.high).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is narrowed by Prudence, and much narrower after a report", () => {
    expect(estimateWidth(borrower(0.5, 0), tuning)).toBeCloseTo(t.estimate.width * (1 - tuning.start.head_prudence * t.estimate.prudence_step));
    const before = estimateRange(borrower(0.5, 0.4), tuning);
    const after = estimateRange(borrower(0.5, 0.4, true), tuning);
    expect(after.high - after.low).toBeLessThan(before.high - before.low);
    expect(after.high - after.low).toBeLessThanOrEqual(2 * t.estimate.report_width + 0.02);
  });

  it("is off-centre by the borrower's fixed noise", () => {
    const r = estimateRange(borrower(0.5, 1), tuning);
    const w = estimateWidth(borrower(0.5, 1), tuning);
    // Bounds are rounded outwards to the hundredth, so the range never shrinks past the truth.
    expect(r.low).toBe(0.5);
    expect(r.high).toBe(Math.ceil((0.5 + 2 * w) * 100) / 100);
  });
});

describe("drawRequests", () => {
  it("asks for requests_per_quarter loans, sorted by borrower, at the market's rate", () => {
    const s = newGame(gameData, createRng(3));
    const rs = drawRequests(s, gameData, createRng(4));
    expect(rs).toHaveLength(t.requests_per_quarter);
    expect(rs.map((r) => r.borrower_id)).toEqual([...rs.map((r) => r.borrower_id)].sort((a, b) => a - b));
    for (const r of rs) {
      const b = s.borrowers.find((x) => x.id === r.borrower_id)!;
      expect(r.max_rate).toBe(maxRate(b.market_quality, tuning));
      expect(r.amount % 500).toBe(0);
      expect(r.amount).toBeGreaterThanOrEqual(t.request_amount.min);
      expect(r.amount).toBeLessThanOrEqual(t.request_amount.max);
    }
  });

  it("leaves out borrowers with an active loan", () => {
    const s = fresh();
    const lent = decide(s, { kind: "lend", borrower: GOOD, amount: 5000, rate: 0.06 });
    for (let seed = 1; seed < 30; seed++) {
      expect(drawRequests(lent, { ...gameData, tuning: { ...tuning, loans: { ...t, requests_per_quarter: 4 } } }, createRng(seed)).map((r) => r.borrower_id)).not.toContain(GOOD);
    }
  });

  it("keeps a defaulter away for defaulter_absence_quarters, then lets them ask again", () => {
    const s = fresh();
    const b = s.borrowers.find((x) => x.id === POOR)!;
    b.away_until = s.world.turn + t.defaulter_absence_quarters;
    const everyone = { ...gameData, tuning: { ...tuning, loans: { ...t, requests_per_quarter: 4 } } };
    expect(drawRequests(s, everyone, createRng(1)).map((r) => r.borrower_id)).not.toContain(POOR);
    s.world.turn += t.defaulter_absence_quarters;
    expect(drawRequests(s, everyone, createRng(1)).map((r) => r.borrower_id)).toContain(POOR);
  });

  it("asks for more from a borrower who has repaid, up to max_growth", () => {
    const s = fresh();
    s.borrowers = [s.borrowers[0]!];
    const amount = (repaid: number) => {
      s.borrowers[0]!.repaid = repaid;
      return drawRequests(s, gameData, fixedRng(0, 0.5))[0]!.amount;
    };
    const base = amount(0);
    expect(amount(2)).toBe(Math.round((base * (1 + 2 * t.request_amount.growth_per_repaid)) / 500) * 500);
    expect(amount(100)).toBe(Math.round((base * t.request_amount.max_growth) / 500) * 500);
  });

  it("returns nothing when no one is free to ask", () => {
    const s = fresh();
    s.borrowers = [];
    expect(drawRequests(s, gameData, createRng(1))).toEqual([]);
  });
});

describe("lending to a named borrower", () => {
  it("records the borrower on the loan and closes their request for the quarter", () => {
    const s = decide(fresh(), { kind: "lend", borrower: FAIR, amount: 5000, rate: 0.1 });
    expect(s.loans[0]).toMatchObject({ borrower_id: FAIR, borrower_name: "Fair and Co.", quality: 0.6 });
    expect(s.requests.map((r) => r.borrower_id)).not.toContain(FAIR);
    expect(checkLend(s, { kind: "lend", borrower: FAIR, amount: 5000, rate: 0.1 }, tuning)).toMatch(/not asking for a loan/);
  });

  it("refuses unknown borrowers, those not asking, more than asked, or a rate above their maximum", () => {
    const s = fresh();
    expect(checkLend(s, { kind: "lend", borrower: 99, amount: 5000, rate: 0.05 }, tuning)).toBe("Unknown borrower #99");
    s.requests = s.requests.filter((r) => r.borrower_id !== POOR);
    expect(checkLend(s, { kind: "lend", borrower: POOR, amount: 5000, rate: 0.05 }, tuning)).toBe("Poor and Co. is not asking for a loan this quarter");
    s.requests.find((r) => r.borrower_id === GOOD)!.amount = 8000;
    expect(checkLend(s, { kind: "lend", borrower: GOOD, amount: 8500, rate: 0.05 }, tuning)).toBe("Good and Co. wants no more than 8,000 fl.");
    expect(checkLend(s, { kind: "lend", borrower: GOOD, amount: 8000, rate: 0.065 }, tuning)).toBe("Good and Co. will not pay more than 6.0%");
  });
});

describe("borrower records", () => {
  it("count a default, keep the defaulter away, and lower the market's view", () => {
    const s0 = decide(fresh(), { kind: "lend", borrower: POOR, amount: 5000, rate: 0.16 });
    const s = endTurn(s0, [], fixedRng(0, 0.999999), quiet);
    const b = s.borrowers.find((x) => x.id === POOR)!;
    expect(b).toMatchObject({ defaulted: 1, last_default_turn: 1, away_until: 1 + t.defaulter_absence_quarters });
    expect(b.market_quality).toBeCloseTo(0.3 - t.market.default_penalty);
    expect(b.quality).toBe(0.3);
  });

  it("count a repayment and raise the market's view", () => {
    let s = decide(fresh(), { kind: "lend", borrower: GOOD, amount: 5000, rate: 0.06 });
    for (let i = 0; i < t.term_quarters; i++) s = endTurn(s, [], noDefaults, quiet);
    const b = s.borrowers.find((x) => x.id === GOOD)!;
    expect(b.repaid).toBe(1);
    expect(b.market_quality).toBeCloseTo(0.9 + t.market.repaid_bonus);
  });
});

describe("correspondent's report", () => {
  it("costs cash and an action, narrows the estimate, and writes a ledger entry", () => {
    const s0 = fresh();
    const s = decide(s0, { kind: "report", borrower: FAIR });
    const b = s.borrowers.find((x) => x.id === FAIR)!;
    expect(b.reported).toBe(true);
    expect(s.house.cash).toBe(s0.house.cash - t.estimate.report_cost);
    expect(s.actions_this_turn).toBe(1);
    expect(s.ledger.at(-1)).toMatchObject({ account: "cash", category: "report", amount: -t.estimate.report_cost });
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
  });

  it("is refused twice for the same borrower, for one not asking, or without the cash", () => {
    const s = decide(fresh(), { kind: "report", borrower: FAIR });
    expect(checkReport(s, { kind: "report", borrower: FAIR }, tuning)).toBe("You already have a report on Fair and Co.");
    s.requests = [];
    expect(checkReport(s, { kind: "report", borrower: GOOD }, tuning)).toBe("Good and Co. is not asking for a loan this quarter");
    const poor = fresh();
    poor.house.cash = 100;
    expect(checkReport(poor, { kind: "report", borrower: GOOD }, tuning)).toMatch(/^Not enough cash above the reserve/);
    expect(buyReport(poor, { kind: "report", borrower: GOOD }, gameData).ok).toBe(false);
  });
});

describe("End Turn and requests", () => {
  it("draws a new set of requests for the next quarter", () => {
    const rng = createRng(11);
    const s0 = newGame(gameData, rng);
    const s1 = endTurn(s0, [], rng, gameData);
    expect(s1.requests).toHaveLength(t.requests_per_quarter);
  });

  it("a borrower who repays comes back asking for more, in a long run", () => {
    const rng = createRng(5);
    let s = newGame(gameData, rng);
    for (let i = 0; i < 40; i++) {
      const lends = s.requests.slice(0, 1).map((r): Decision => ({ kind: "lend", borrower: r.borrower_id, amount: Math.min(r.amount, 5000), rate: r.max_rate }));
      s = endTurn(s, lends, rng, gameData);
    }
    expect(s.borrowers.some((b) => b.repaid >= 2)).toBe(true);
  });
});
