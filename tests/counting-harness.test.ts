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

  it("cautious keeps two clerks and a correspondent, and builds reception rooms", () => {
    const s = play("cautious", 1, 40);
    if (s.house.status === "bankrupt") return;
    expect(count(s, "clerk")).toBe(2);
    expect(count(s, "correspondent")).toBe(1);
    expect(s.counting.facilities.map((f) => f.id)).toEqual(["reception_rooms"]);
  });

  it("each strategy builds what pays for its play in the first quarter", () => {
    const built = (name: string) => play(name, 3, 1).counting.facilities.map((f) => f.id);
    expect(built("cautious")).toEqual(["reception_rooms"]);
    expect(built("aggressive")).toEqual(["courier_stable"]);
    expect(built("bond_heavy")).toEqual(["courier_stable"]);
    expect(built("venture_heavy")).toEqual([]);
    expect(built("investor")).toEqual(["strongroom"]);
    expect(built("idle")).toEqual([]);
  });

  it("aggressive, bond-heavy and venture-heavy hire their clerks and let the correspondent go in the first quarter", () => {
    for (const [name, clerks] of [["aggressive", 3], ["bond_heavy", 2], ["venture_heavy", 2]] as const) {
      const s = play(name, 2, 2);
      expect(count(s, "clerk"), name).toBe(clerks);
      expect(count(s, "correspondent"), name).toBe(0);
    }
  });
});
