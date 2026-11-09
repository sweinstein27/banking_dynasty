import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { STRATEGIES } from "../src/harness/strategies";
import { applyDecisions } from "../src/sim/decisions";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { accountBalance } from "../src/sim/ledger";
import { politicsBook } from "../src/sim/systems/politics";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";

const POLITICS = new Set(["stand_for_office", "cultivate_influence", "seek_court", "lend_court", "senate_assurance"]);

function play(name: string, seed: number): { state: GameState; decisions: Decision[] } {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  const decisions: Decision[] = [];
  while (!runOver(s, gameData.tuning)) {
    const ds = STRATEGIES[name]!(s, gameData);
    const r = applyDecisions(s, ds, gameData);
    if (!r.ok) throw new Error(`${name} seed ${seed} turn ${s.world.turn}: ${r.reason}`);
    decisions.push(...ds);
    s = endTurn(s, ds, rng, gameData);
    expect(accountBalance(s, "court_loans")).toBe(politicsBook(s));
  }
  return { state: s, decisions };
}

const SEEDS = [1, 2, 3, 4, 5, 6];
const kinds = (name: string) => SEEDS.flatMap((seed) => play(name, seed).decisions.map((d) => d.kind).filter((k) => POLITICS.has(k)));

// Whole runs: slow, so each test gets 30 s.
describe("politics in the harness", { timeout: 30_000 }, () => {
  it("cautious stands for the Senate; idle does nothing political", () => {
    expect(kinds("cautious")).toContain("stand_for_office");
    expect(kinds("idle")).toEqual([]);
  });

  it("aggressive does nothing political, and no strategy plays courts", () => {
    expect(kinds("aggressive")).toEqual([]);
    for (const name of ["cautious", "bond_heavy", "investor"]) expect(kinds(name).filter((k) => k !== "stand_for_office" && k !== "senate_assurance"), name).toEqual([]);
  });

  it("bond_heavy stands for office", () => {
    expect(kinds("bond_heavy")).toContain("stand_for_office");
  });
});
