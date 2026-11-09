import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import type { Strategy } from "../src/harness/common";
import { STRATEGIES } from "../src/harness/strategies";
import { runOver } from "../src/sim/actions";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";

/** A full run, checking every turn's decisions are accepted, and collecting them. */
function run(strategy: Strategy, seed: number): { state: GameState; decisions: Decision[] } {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  const decisions: Decision[] = [];
  while (!runOver(s, gameData.tuning)) {
    const ds = strategy(s, gameData);
    const r = applyDecisions(s, ds, gameData);
    if (!r.ok) throw new Error(`seed ${seed} turn ${s.world.turn}: ${r.reason}`);
    decisions.push(...ds);
    s = endTurn(s, ds, rng, gameData);
  }
  return { state: s, decisions };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const runs = Object.fromEntries(Object.entries(STRATEGIES).map(([name, st]) => [name, SEEDS.map((seed) => run(st, seed))]));
const kinds = (name: string) => runs[name]!.flatMap((r) => r.decisions.map((d) => (d.kind === "invest_family" ? `${d.kind}:${d.form}` : d.kind)));

describe("harness strategies", () => {
  it("answer letters in their own style: cautious pays, aggressive takes the chance, the rest leave the default", () => {
    const replies = (name: string) => runs[name]!.flatMap((r) => r.decisions.filter((d) => d.kind === "answer_letter")).map((d) => `${d.event}/${d.option}`);
    const cautious = new Set(replies("cautious"));
    const aggressive = new Set(replies("aggressive"));
    expect(cautious.size).toBeGreaterThan(0);
    expect([...cautious].every((r) => ["clerk-skimming/prosecute", "rival-rumours/open-books", "heir-illness/doctors", "heir-talent/university", "bridge-gift/give", "pamphleteer/pay", "war-september-1848/senate", "politics-hep-hep/aid"].includes(r)), [...cautious].join()).toBe(true);
    expect([...aggressive].every((r) => ["clerk-skimming/dismiss", "rival-rumours/answer", "heir-illness/local", "pamphleteer/refuse", "war-september-1848/wait", "politics-september-1848/talks"].includes(r)), [...aggressive].join()).toBe(true);
    for (const name of ["idle", "bond_heavy", "venture_heavy"]) expect(replies(name), name).toEqual([]);
  });

  it("play whole runs with only decisions the sim accepts", () => {
    for (const rs of Object.values(runs)) for (const r of rs) expect(runOver(r.state, gameData.tuning)).not.toBeNull();
  });

  it("are deterministic", () => {
    for (const [name, st] of Object.entries(STRATEGIES)) expect(run(st, 3).state, name).toEqual(runs[name]![2]!.state);
  });

  it("idle decides nothing but dismissing its staff (A2)", () => {
    expect(new Set(kinds("idle"))).toEqual(new Set(["dismiss"]));
    // Three on the first quarter of each seed, and never again.
    expect(runs.idle!.every((r) => r.decisions.length === gameData.counting.start.staff.length)).toBe(true);
  });

  it("cautious keeps a reserve, checks borrowers, lends, buys safe bonds and educates heirs", () => {
    const k = kinds("cautious");
    for (const kind of ["set_reserve", "report", "lend", "buy_bond", "invest_family:educate"]) expect(k, kind).toContain(kind);
    const bonds = runs.cautious!.flatMap((r) => r.decisions).filter((d) => d.kind === "buy_bond").map((d) => (d as { state: string }).state);
    expect(new Set(bonds)).not.toContain("naples");
  });

  it("aggressive lends, buys risky bonds and backs ventures", () => {
    const k = kinds("aggressive");
    for (const kind of ["lend", "buy_bond", "invest_venture"]) expect(k, kind).toContain(kind);
    expect(k).not.toContain("report");
  });

  it("bond-heavy puts more into bonds than anything else", () => {
    // Measured in gulden, not decisions (B1): a small loan every quarter can outnumber bond purchases
    // the reputation gates hold back, while the money still goes mostly into bonds.
    const ds = runs.bond_heavy!.flatMap((r) => r.decisions);
    const bonds = ds.reduce((n, d) => n + (d.kind === "buy_bond" ? d.face_value : 0), 0);
    const lent = ds.reduce((n, d) => n + (d.kind === "lend" ? d.amount : 0), 0);
    expect(bonds).toBeGreaterThan(lent);
  });

  it("venture-heavy backs ventures, including railways once they open", () => {
    const ventures = runs.venture_heavy!.flatMap((r) => r.decisions).filter((d) => d.kind === "invest_venture").map((d) => (d as { venture: string }).venture);
    expect(ventures.length).toBeGreaterThan(0);
    expect(ventures).toContain("railway");
  });

  it("aggressive borrows from the rival in a panic on some seed", () => {
    let borrowed = false;
    for (let seed = 1; seed <= 40 && !borrowed; seed++) borrowed = run(STRATEGIES.aggressive!, seed).decisions.some((d) => d.kind === "borrow");
    expect(borrowed).toBe(true);
  });
});
