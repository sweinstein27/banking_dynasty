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
    expect(ds.length).toBeLessThanOrEqual(gameData.tuning.actions_per_turn);
    decisions.push(...ds);
    s = endTurn(s, ds, rng, gameData);
  }
  return { state: s, decisions };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const runs = Object.fromEntries(Object.entries(STRATEGIES).map(([name, st]) => [name, SEEDS.map((seed) => run(st, seed))]));
const kinds = (name: string) => runs[name]!.flatMap((r) => r.decisions.map((d) => (d.kind === "invest_family" ? `${d.kind}:${d.form}` : d.kind)));

describe("harness strategies", () => {
  it("play whole runs with only decisions the sim accepts", () => {
    for (const rs of Object.values(runs)) for (const r of rs) expect(runOver(r.state, gameData.tuning)).not.toBeNull();
  });

  it("are deterministic", () => {
    for (const [name, st] of Object.entries(STRATEGIES)) expect(run(st, 3).state, name).toEqual(runs[name]![2]!.state);
  });

  it("idle never decides anything", () => {
    expect(kinds("idle")).toEqual([]);
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
    const k = kinds("bond_heavy");
    expect(k.filter((x) => x === "buy_bond").length).toBeGreaterThan(k.filter((x) => x === "lend").length);
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
