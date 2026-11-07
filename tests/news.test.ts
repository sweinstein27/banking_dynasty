import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState, NewsKind } from "../src/sim/types";
import { fixedRng, fresh, GOOD, noDefaults, PANIC_SEED, POOR, quiet } from "./helpers";

/** A2: the real data with the quiet counting house, so PANIC_SEED plays the run it was picked for. */
const quietHouse = { ...gameData, counting: quiet.counting };
import { aggressiveDecisions, play } from "../src/harness/golden";

function decide(s: GameState, ...ds: Decision[]): GameState {
  for (const d of ds) {
    const r = applyDecision(s, d, gameData);
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  }
  return s;
}

const kinds = (s: GameState) => s.news.map((n) => n.kind);

describe("quarter news", () => {
  it("is empty for a quiet calm quarter", () => {
    const s = endTurn(fresh(), [], noDefaults, quiet);
    expect(s.news).toEqual([]);
  });

  it("reports a mood change, tagged with the turn that produced it", () => {
    // No holdings, so the only roll is the mood roll: 0 moves calm to uneasy.
    const s = endTurn(fresh(), [], fixedRng(0), quiet);
    expect(s.news).toEqual([{ turn: 1, kind: "mood", text: "Market sentiment turns uneasy (was calm)." }]);
  });

  it("reports a loan default with the borrower's name and principal", () => {
    const s0 = fresh();
    const s = endTurn(s0, [{ kind: "lend", amount: 10000, rate: 0.16, borrower: POOR }], fixedRng(0, 0.999), quiet);
    const name = s.loans[0]!.borrower_name;
    expect(s.news).toEqual([
      { turn: 1, kind: "loan_default", text: `${name} defaulted, losing the full principal of 10,000 fl.` },
    ]);
  });

  it("reports a state default with the book value written off", () => {
    const s = endTurn(fresh(), [{ kind: "buy_bond", state: "naples", face_value: 10000 }], fixedRng(0, 0.999), quiet);
    expect(kinds(s)).toEqual(["bond_default"]);
    expect(s.news[0]!.text).toBe("The Kingdom of Naples has defaulted on its bonds. Holdings worth 10,000 fl. are written off.");
  });

  it("reports withdrawals when uneasy", () => {
    const s0 = fresh();
    s0.world.sentiment = "uneasy";
    const s = endTurn(s0, [], noDefaults, quiet);
    expect(s.news).toEqual([{ turn: 1, kind: "withdrawal", text: "Depositors withdrew 1,000 fl. (uneasy)." }]);
  });

  it("reports a run, forced sales and bankruptcy in a panic the house cannot survive", () => {
    let s0 = fresh();
    s0 = decide(s0, { kind: "lend", amount: 100000, rate: 0.06, borrower: GOOD });
    // Demand is 20% of 500,000; interest of 1,500 plus the whole loan sold for 70,000 cannot cover it.
    s0.house.deposits = 500000;
    s0.world.sentiment = "panic";
    const s = endTurn(s0, [], noDefaults, quiet);
    expect(s.house.status).toBe("bankrupt");
    expect(kinds(s)).toEqual(["withdrawal", "forced_sale", "bankruptcy"]);
    expect(s.news[0]!.text).toMatch(/A run on the bank\.$/);
    // 100,000 of principal sold at a 30% discount raises 70,000 and loses 30,000.
    expect(s.news[1]!.text).toBe("Assets were sold at a discount to pay depositors: 1 sale(s) raised 70,000 fl., losing 30,000 fl. of book value.");
  });

  it("never ends a sentence with a doubled full stop", () => {
    const a = play(aggressiveDecisions, PANIC_SEED, 20, quietHouse).state;
    expect(a.news.filter((n) => n.text.includes(".."))).toEqual([]);
  });

  it("reports a venture paying out at the end of its term", () => {
    let s = endTurn(fresh(), [{ kind: "invest_venture", venture: "mill", amount: 10000 }], noDefaults, quiet);
    for (let i = 1; i < 8; i++) s = endTurn(s, [], noDefaults, quiet);
    expect(s.news).toEqual([
      { turn: 8, kind: "venture_paid_out", text: "Venture #1 (Textile mill) succeeded, turning a stake of 10,000 fl. into 14,000 fl." },
    ]);
  });

  it("reports a venture failing", () => {
    let s = endTurn(fresh(), [{ kind: "invest_venture", venture: "mill", amount: 10000 }], noDefaults, quiet);
    for (let i = 1; i < 7; i++) s = endTurn(s, [], noDefaults, quiet);
    s = endTurn(s, [], fixedRng(0, 0.999), quiet);
    expect(s.news.at(-1)).toEqual({ turn: 8, kind: "venture_failed", text: "Venture #1 (Textile mill) failed. The stake of 10,000 fl. is lost." });
  });

  it("keeps every quarter's news, and is the same on a replay", () => {
    const a = play(aggressiveDecisions, PANIC_SEED, 20, quietHouse).state;
    const b = play(aggressiveDecisions, PANIC_SEED, 20, quietHouse).state;
    expect(a.news).toEqual(b.news);
    const seen = new Set<NewsKind>(kinds(a));
    for (const k of ["withdrawal", "forced_sale", "bond_default", "mood"] as const) expect(seen).toContain(k);
    expect(a.news.every((n, i) => i === 0 || n.turn >= a.news[i - 1]!.turn)).toBe(true);
  });
});
