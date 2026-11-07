// The top bar's breakdowns (src/ui/model) must agree with the sim: every section that shows a total
// adds up to it, the totals equal the numbers on the bar, and net worth rebuilt from the ledger
// matches the sim's own figure for the quarter before.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { aggressiveDecisions, economyDecisions } from "../src/harness/golden";
import type { Strategy } from "../src/harness/common";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn, netWorth } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { breakdown, upkeepTotal, worthBefore, type BreakdownId } from "../src/ui/model/breakdowns";
import { readouts } from "../src/ui/model/readouts";
import { PANIC_SEED } from "./helpers";

const IDS: BreakdownId[] = ["cash", "worth", "reputation", "deposits", "upkeep", "market", "date"];

/** Every section with a total adds up to it. */
function expectSums(base: GameState, preview: GameState) {
  for (const id of IDS) {
    for (const s of breakdown(id, base, preview, gameData).sections) {
      if (!s.total) continue;
      const sum = s.lines.reduce((n, l) => n + (l.amount ?? 0), 0);
      expect(sum, `${id}: ${s.heading}`).toBe(s.total.amount);
    }
  }
}

/** Plays `turns` quarters, checking the breakdowns before and after each quarter's orders. */
function playChecked(strategy: Strategy, seed: number, turns: number) {
  const rng = createRng(seed);
  let base = newGame(gameData, rng);
  for (let i = 0; i < turns && base.house.status !== "bankrupt"; i++) {
    const ds = strategy(base, gameData);
    const r = applyDecisions(base, ds, gameData);
    if (!r.ok) throw new Error(r.reason);
    expectSums(base, base);
    expectSums(base, r.state);
    const totals = (id: BreakdownId) => breakdown(id, base, r.state, gameData).sections.find((s) => s.total)?.total?.amount;
    expect(totals("cash")).toBe(base.house.cash);
    expect(totals("deposits")).toBe(base.house.deposits);
    expect(totals("worth")).toBe(netWorth(r.state));
    expect(totals("upkeep")).toBe(upkeepTotal(r.state, gameData));
    const next = endTurn(base, ds, rng, gameData);
    // Net worth when the quarter began, rebuilt from that quarter's entries, is the sim's own figure.
    expect(worthBefore(next)).toBe(netWorth(base));
    base = next;
  }
  return base;
}

describe("top bar breakdowns", () => {
  it("add up, quarter by quarter, across the full economy", () => {
    playChecked(economyDecisions, 1815, 20);
  });

  it("add up through panics, bank runs and forced sales", () => {
    playChecked(aggressiveDecisions, PANIC_SEED, 20);
  });

  it("add up for a bankrupt house", () => {
    const s = newGame(gameData, createRng(3));
    s.house.cash = 0;
    s.house.status = "bankrupt";
    expectSums(s, s);
  });

  it("show the opening books before the first quarter ends", () => {
    const s = newGame(gameData, createRng(1));
    const cash = breakdown("cash", s, s, gameData).sections[0]!;
    expect(cash.heading).toBe("The opening books");
    expect(cash.lines[0]!.amount).toBe(0);
    expect(cash.total!.amount).toBe(gameData.tuning.start.cash);
    expect(worthBefore(s)).toBe(0);
  });

  it("show queued orders as their own section, ending at the preview's balance", () => {
    const s = newGame(gameData, createRng(1));
    const r = applyDecisions(s, [{ kind: "invest_family", form: "charity" }], gameData);
    if (!r.ok) throw new Error(r.reason);
    const orders = breakdown("cash", s, r.state, gameData).sections.find((x) => x.heading === "This quarter's orders so far");
    expect(orders?.total?.amount).toBe(r.state.house.cash);
    expect(orders!.lines[0]!.amount).toBe(s.house.cash);
  });

  it("every readout has a value with its unit where it is money", () => {
    const s = newGame(gameData, createRng(1));
    const byId = Object.fromEntries(readouts(s, s, gameData).map((r) => [r.id, r]));
    for (const id of ["cash", "worth", "deposits", "upkeep"]) expect(byId[id]!.value).toMatch(/ fl\.$/);
    expect(byId.date!.label).toBe("Quarter 1 of 144");
  });
});
