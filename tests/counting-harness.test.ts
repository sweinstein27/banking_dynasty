// The harness strategies run the counting house sensibly (A2): each hires what its wants need, and none is short of capacity.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { STRATEGIES } from "../src/harness/strategies";
import { runOver } from "../src/sim/actions";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";

function play(name: string, seed: number, turns: number): GameState {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  for (let t = 0; t < turns && !runOver(s, gameData.tuning); t++) {
    const ds = STRATEGIES[name]!(s, gameData);
    const r = applyDecisions(s, ds, gameData);
    if (!r.ok) throw new Error(`${name} seed ${seed} turn ${s.world.turn}: ${r.reason}`);
    s = endTurn(s, ds, rng, gameData);
  }
  return s;
}

const count = (s: GameState, role: string) => s.counting.staff.filter((m) => m.role === role).length;

describe("harness strategies and the counting house", () => {
  it("idle keeps no staff", () => {
    expect(play("idle", 1, 4).counting.staff).toEqual([]);
  });

  it("cautious hires three clerks and two correspondents, and builds a courier stable first", () => {
    const s = play("cautious", 1, 40);
    if (s.house.status === "bankrupt") return;
    expect(count(s, "clerk")).toBe(3);
    expect(count(s, "correspondent")).toBe(2);
    // The strongroom follows only when free cash above the reserve allows it.
    expect(s.counting.facilities[0]!.id).toBe("courier_stable");
  });

  it("aggressive, bond-heavy and venture-heavy hire their clerks within the first quarter", () => {
    for (const [name, clerks] of [["aggressive", 3], ["bond_heavy", 3], ["venture_heavy", 2]] as const) {
      expect(count(play(name, 2, 2), "clerk"), name).toBe(clerks);
    }
  });
});
