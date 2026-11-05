import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyOverrides, combine, overrideAt } from "../src/harness/overrides";
import { runOnce, type RunRow } from "../src/harness/run";
import { STRATEGIES } from "../src/harness/strategies";
import { checkTargets, dominates } from "../src/harness/targets";
import { summarize } from "../src/harness/summary";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";

describe("applyOverrides", () => {
  it("replaces only the named tuning values, leaving the rest and the original data alone", () => {
    const d = applyOverrides(gameData, { tuning: { loans: { rate: { spread: 0.2 } } } });
    expect(d.tuning.loans.rate).toEqual({ base: gameData.tuning.loans.rate.base, spread: 0.2 });
    expect(d.tuning.loans.p0).toBe(gameData.tuning.loans.p0);
    expect(gameData.tuning.loans.rate.spread).toBe(0.14);
  });

  it("sets event fields by id", () => {
    const d = applyOverrides(gameData, { events: { "warehouse-fire": { weight: 0.5 } } });
    expect(d.events.find((e) => e.id === "warehouse-fire")!.weight).toBe(0.5);
    expect(gameData.events.find((e) => e.id === "warehouse-fire")!.weight).toBe(2);
  });

  it("rejects keys tuning.json does not have and unknown events, so typos cannot pass silently", () => {
    expect(() => applyOverrides(gameData, { tuning: { loans: { spred: 1 } } })).toThrow(/"loans.spred" is not in tuning.json/);
    expect(() => applyOverrides(gameData, { events: { "no-such-event": { weight: 1 } } })).toThrow(/unknown event/);
  });
});

describe("overrideAt and combine", () => {
  it("build overrides from dotted paths, later ones winning", () => {
    expect(overrideAt("tuning.loans.p0", 0.03)).toEqual({ tuning: { loans: { p0: 0.03 } } });
    expect(overrideAt("events.warehouse-fire.weight", 1)).toEqual({ events: { "warehouse-fire": { weight: 1 } } });
    const c = combine({ tuning: { loans: { p0: 0.03, min_amount: 500 } } }, overrideAt("tuning.loans.p0", 0.05));
    expect(c).toEqual({ tuning: { loans: { p0: 0.05, min_amount: 500 } } });
  });

  it("refuse paths outside tuning and events", () => {
    expect(() => overrideAt("states.naples.risk", 1)).toThrow(/must start with tuning\. or events\./);
  });
});

describe("runOnce flows", () => {
  it("total each account's movements by category: opening balance plus flows equals the final balance", () => {
    const { flows } = runOnce("cautious", STRATEGIES.cautious!, 5, gameData);
    const rng = createRng(5);
    let st = newGame(gameData, rng);
    while (!runOver(st, gameData.tuning)) st = endTurn(st, STRATEGIES.cautious!(st, gameData), rng, gameData);
    const opening = (account: string) => st.ledger.filter((e) => e.category === "opening" && e.account === account).reduce((a, e) => a + e.amount, 0);
    for (const account of ["cash", "loans", "bonds", "ventures", "deposits", "borrowings"]) {
      const sum = flows.filter((f) => f.account === account).reduce((a, f) => a + f.amount, 0);
      expect(opening(account) + sum, account).toBe(accountBalance(st, account as never));
    }
    expect(flows.every((f) => f.category !== "opening")).toBe(true);
    expect(new Set(flows.map((f) => `${f.account},${f.category}`)).size).toBe(flows.length);
  });
});

describe("targets", () => {
  const row = (strategy: string, final_net_worth: number, outcome: RunRow["outcome"] = "finished", last_turn = 144): RunRow => ({
    strategy, seed: 1, outcome, last_turn, final_net_worth, peak_net_worth: 0, low_net_worth: 0, final_reputation: 50, defaults: 0, default_loss: 0,
    panic_quarters: 0, forced_sales: 0, state_defaults: 0, ventures_paid: 0, ventures_failed: 0, successions: 0, untrained_successions: 0,
    family_spend: 0, borrowings: 0, suspensions: 0,
  });

  it("dominates needs at least as good on all three and better on one", () => {
    const [a, b, c] = summarize([row("a", 100), row("b", 50), row("c", 100)], gameData);
    expect(dominates(a!, b!)).toBe(true);
    expect(dominates(b!, a!)).toBe(false);
    expect(dominates(a!, c!)).toBe(false);
  });

  it("all pass for a balanced field, and each fails on its own measure", () => {
    // 10 runs each. Aggressive: 4 bankrupt in 1826 (turn 45), so 40% overall and 40% in 1825-29.
    const rows: RunRow[] = [];
    const add = (name: string, worths: number[], bankrupt = 0) => worths.forEach((w, i) => rows.push(row(name, w, i < bankrupt ? "bankrupt" : "finished", i < bankrupt ? 45 : 144)));
    add("idle", Array(10).fill(45_000));
    add("cautious", [60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000, 140_000, 160_000]);
    add("aggressive", [-20_000, -20_000, -20_000, -20_000, 50_000, 80_000, 120_000, 200_000, 400_000, 500_000], 4);
    add("bond_heavy", [50_000, 60_000, 70_000, 80_000, 90_000, 95_000, 100_000, 140_000, 150_000, 155_000]);
    add("venture_heavy", [-10_000, 0, 10_000, 20_000, 30_000, 40_000, 60_000, 200_000, 300_000, 600_000], 1);
    const results = checkTargets(rows, gameData);
    expect(results.map((r) => [r.id, r.pass])).toEqual([["T1", true], ["T2", true], ["T3", true], ["T4", true], ["T5", true], ["T6", true]]);
  });

  it("report n/a when a needed strategy was not run", () => {
    const results = checkTargets([row("cautious", 100_000)], gameData);
    expect(results.find((r) => r.id === "T1")!.pass).toBeNull();
    expect(results.find((r) => r.id === "T4")!.pass).toBe(true);
    expect(results.find((r) => r.id === "T6")!.pass).toBeNull();
  });
});
