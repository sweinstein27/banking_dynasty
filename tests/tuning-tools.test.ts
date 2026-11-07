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
    const spread = gameData.tuning.loans.rate.spread;
    const d = applyOverrides(gameData, { tuning: { loans: { rate: { spread: spread + 0.01 } } } });
    expect(d.tuning.loans.rate).toEqual({ base: gameData.tuning.loans.rate.base, spread: spread + 0.01 });
    expect(d.tuning.loans.p0).toBe(gameData.tuning.loans.p0);
    expect(gameData.tuning.loans.rate.spread).toBe(spread);
  });

  it("sets event fields by id", () => {
    const d = applyOverrides(gameData, { events: { "warehouse-fire": { weight: 0.5 } } });
    expect(d.events.find((e) => e.id === "warehouse-fire")!.weight).toBe(0.5);
    expect(gameData.events.find((e) => e.id === "warehouse-fire")!.weight).toBe(2);
  });

  it("rejects keys tuning.json does not have and unknown events, so typos cannot pass silently", () => {
    expect(() => applyOverrides(gameData, { tuning: { loans: { spred: 1 } } })).toThrow(/"loans.spred" is not in tuning.json/);
    expect(() => applyOverrides(gameData, { events: { "no-such-event": { weight: 1 } } })).toThrow(/unknown event/);
    expect(() => applyOverrides(gameData, { states: { atlantis: { coupon: 1 } } })).toThrow(/unknown state "atlantis"/);
    expect(() => applyOverrides(gameData, { states: { naples: { name: "x" } as never } })).toThrow(/Cannot override states\.naples\.name/);
  });

  it("sets state and venture fields by id", () => {
    const coupon = gameData.states.find((s) => s.id === "naples")!.coupon;
    const d = applyOverrides(gameData, { states: { naples: { coupon: coupon + 0.01 } }, ventures: { mill: { expected_return: 0.5 } } });
    expect(d.states.find((s) => s.id === "naples")!.coupon).toBe(coupon + 0.01);
    expect(d.ventures.find((v) => v.id === "mill")!.expected_return).toBe(0.5);
    expect(gameData.states.find((s) => s.id === "naples")!.coupon).toBe(coupon);
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
    expect(() => overrideAt("borrowers.weber.quality", 1)).toThrow(/must start with tuning\., credit\., markets\., counting\., scale\., events\., states\. or ventures\./);
    expect(overrideAt("states.naples.coupon", 0.08)).toEqual({ states: { naples: { coupon: 0.08 } } });
    expect(combine(overrideAt("states.naples.coupon", 0.08), overrideAt("states.naples.risk", 0.5))).toEqual({ states: { naples: { coupon: 0.08, risk: 0.5 } } });
  });
});

describe("overrides for the wave 1 systems", () => {
  it("merge into credit, markets and counting data, refusing unknown keys", () => {
    const d = applyOverrides(gameData, combine(overrideAt("credit.info.inquiry_cost", 600), overrideAt("markets.prices.speed", 0.5)));
    expect(d.credit.info.inquiry_cost).toBe(600);
    expect(d.credit.info.report_cost).toBe(gameData.credit.info.report_cost);
    expect(d.markets.prices.speed).toBe(0.5);
    expect(() => applyOverrides(gameData, overrideAt("credit.info.nonsense", 1))).toThrow(/not in tuning\.json|nonsense/);
  });

  it("scale a field on every record of a list, leaving the real data alone", () => {
    const d = applyOverrides(gameData, overrideAt("scale.ventures.failure_risk", 2));
    expect(d.ventures.map((v) => v.failure_risk)).toEqual(gameData.ventures.map((v) => v.failure_risk * 2));
    const m = applyOverrides(gameData, overrideAt("scale.markets.sectors.growth", 0));
    expect(m.markets.sectors.every((x) => x.growth === 0)).toBe(true);
    expect(gameData.markets.sectors.some((x) => x.growth > 0)).toBe(true);
    expect(() => applyOverrides(gameData, overrideAt("scale.ventures.name", 2))).toThrow(/no number/);
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
    // 10 runs each. Aggressive: 4 bankrupt in 1826 (turn 45), so 40% overall and 40% in 1825-29 (floor 12%).
    const rows: RunRow[] = [];
    const add = (name: string, worths: number[], bankrupt = 0) => worths.forEach((w, i) => rows.push(row(name, w, i < bankrupt ? "bankrupt" : "finished", i < bankrupt ? 45 : 144)));
    add("idle", Array(10).fill(45_000));
    add("cautious", [60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000, 140_000, 160_000]);
    add("aggressive", [-20_000, -20_000, -20_000, -20_000, 50_000, 80_000, 120_000, 200_000, 400_000, 500_000], 4);
    add("bond_heavy", [50_000, 60_000, 70_000, 80_000, 90_000, 95_000, 100_000, 140_000, 150_000, 155_000]);
    add("venture_heavy", [-10_000, 0, 10_000, 20_000, 30_000, 40_000, 60_000, 200_000, 300_000, 600_000], 1);
    add("investor", [-10_000, 20_000, 40_000, 60_000, 70_000, 80_000, 100_000, 150_000, 250_000, 380_000], 1);
    const results = checkTargets(rows, gameData);
    expect(results.map((r) => [r.id, r.pass])).toEqual([["T1", true], ["T2", true], ["T3", true], ["T4", true], ["T5", true], ["T6", true], ["T7", null]]);
  });

  it("T7 passes when educating costs at most 10% of the median", () => {
    const t7 = (withFamily: number, without: number) =>
      checkTargets([row("cautious", withFamily), row("cautious_no_family", without)], gameData).find((r) => r.id === "T7")!.pass;
    expect(t7(90_000, 80_000)).toBe(true);
    expect(t7(72_000, 80_000)).toBe(true);
    expect(t7(71_999, 80_000)).toBe(false);
    expect(t7(74_000, 91_000)).toBe(false);
    // With a negative median, 10% below means further from zero.
    expect(t7(-11_000, -10_000)).toBe(true);
    expect(t7(-11_001, -10_000)).toBe(false);
  });

  it("report n/a when a needed strategy was not run", () => {
    const results = checkTargets([row("cautious", 100_000)], gameData);
    expect(results.find((r) => r.id === "T1")!.pass).toBeNull();
    expect(results.find((r) => r.id === "T4")!.pass).toBe(true);
    expect(results.find((r) => r.id === "T6")!.pass).toBeNull();
  });
});
