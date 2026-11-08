import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { runOnce, type RunRow } from "../src/harness/run";
import { STRATEGIES } from "../src/harness/strategies";
import { percentile, startNetWorth, STRONG_FINISH, summarize } from "../src/harness/summary";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn, netWorth } from "../src/sim/turn";

describe("percentile", () => {
  it("interpolates between ranks like numpy", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110], 0.1)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
  });

  it("handles no values, one value, the ends and unsorted input", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 1)).toBe(3);
    expect(percentile([3, 1, 2], 2)).toBe(3);
    expect(percentile([3, 1, 2], -1)).toBe(1);
  });
});

describe("summarize", () => {
  const row = (strategy: string, outcome: RunRow["outcome"], final_net_worth: number): RunRow => ({
    strategy, seed: 1, outcome, last_turn: 144, final_net_worth, peak_net_worth: 0, low_net_worth: 0, final_reputation: 50, defaults: 0,
    default_loss: 0, panic_quarters: 0, forced_sales: 0, state_defaults: 0, ventures_paid: 0, ventures_failed: 0, successions: 0,
    untrained_successions: 0, family_spend: 0, borrowings: 0, suspensions: 0,
  });

  it("gives each strategy its bankruptcy rate, spread, share above the start and share of strong finishes", () => {
    const rows = [
      row("b", "finished", 200_000),
      row("a", "finished", 40_000),
      row("a", "finished", 60_000),
      row("a", "bankrupt", -10_000),
      row("a", "finished", STRONG_FINISH),
    ];
    const [b, a] = summarize(rows, gameData); // in order of first appearance
    expect(b!.strategy).toBe("b");
    expect(a).toMatchObject({ strategy: "a", runs: 4, bankrupt_rate: 0.25, mean: 60_000, median: 50_000, above_start: 0.5, strong: 0.25 });
    // Sorted: -10,000, 40,000, 60,000, 150,000. p10 sits 0.3 of the way from the first to the second.
    expect(a!.p10).toBeCloseTo(-10_000 + 0.3 * 50_000);
    expect(a!.p90).toBeCloseTo(60_000 + 0.7 * 90_000);
  });

  it("never counts a bankrupt run as a strong finish", () => {
    expect(summarize([row("x", "bankrupt", 999_999)], gameData)[0]!.strong).toBe(0);
  });

  it("starts from opening cash less opening deposits", () => {
    expect(startNetWorth(gameData)).toBe(50_000);
  });
});

describe("runOnce", () => {
  it("matches the same run played directly, with one year row per year", () => {
    const { run, years } = runOnce("idle", STRATEGIES.idle!, 3, gameData);
    const rng = createRng(3);
    let s = newGame(gameData, rng);
    // A2: idle dismisses its staff in the first quarter, then does nothing.
    while (!runOver(s, gameData.tuning)) s = endTurn(s, STRATEGIES.idle!(s, gameData), rng, gameData);
    expect(run).toMatchObject({ strategy: "idle", seed: 3, outcome: "finished", last_turn: 144, final_net_worth: netWorth(s), final_reputation: s.house.reputation });
    expect(years.map((y) => y.year)).toEqual(Array.from({ length: 36 }, (_, i) => 1815 + i));
    expect(years.at(-1)!.net_worth).toBe(netWorth(s));
    expect(run.peak_net_worth).toBeGreaterThanOrEqual(run.final_net_worth);
    expect(run.low_net_worth).toBeLessThanOrEqual(run.final_net_worth);
  });

  it("records a bankruptcy and stops there", () => {
    let found: ReturnType<typeof runOnce> | undefined;
    for (let seed = 1; seed <= 100 && !found; seed++) {
      const r = runOnce("aggressive", STRATEGIES.aggressive!, seed, gameData);
      if (r.run.outcome === "bankrupt") found = r;
    }
    expect(found).toBeDefined();
    expect(found!.run.last_turn).toBeLessThan(144);
    expect(found!.years.length).toBeLessThanOrEqual(Math.ceil(found!.run.last_turn / 4));
    // Plays up to dozens of full runs; with every system in the game this takes several seconds.
  }, 20_000);

  it("is deterministic", () => {
    expect(runOnce("cautious", STRATEGIES.cautious!, 9, gameData)).toEqual(runOnce("cautious", STRATEGIES.cautious!, 9, gameData));
  });

  it("counts defaults and family spending from the ledger", () => {
    const { run } = runOnce("cautious", STRATEGIES.cautious!, 4, gameData);
    expect(run.family_spend % gameData.tuning.family.invest.educate.cost).toBe(0);
    expect(run.family_spend).toBeGreaterThan(0);
    expect(run.default_loss >= 0 && run.defaults >= 0).toBe(true);
  });
});
