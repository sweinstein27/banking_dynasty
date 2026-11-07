// The harness strategies use Europe (C1): aggressive opens branches under the family, investor buys bills.
import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { STRATEGIES } from "../src/harness/strategies";
import { runOver } from "../src/sim/actions";
import { applyDecisions } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { billsBook, branchesBook } from "../src/sim/europe/branches";

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

describe("harness strategies and Europe", () => {
  it("aggressive opens branches once a child is of age, and its books match the ledger", () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => play("aggressive", seed, 72));
    expect(runs.some((s) => s.ledger.some((e) => e.category === "branch_opening"))).toBe(true);
    for (const s of runs) expect(accountBalance(s, "branches")).toBe(branchesBook(s));
  });

  it("investor buys bills; the others leave Europe alone", () => {
    const s = play("investor", 3, 8);
    expect(s.ledger.some((e) => e.category === "bill_purchase")).toBe(true);
    expect(accountBalance(s, "bills")).toBe(billsBook(s));
    for (const name of ["cautious", "bond_heavy", "venture_heavy"]) {
      const t = play(name, 3, 8);
      expect(t.ledger.some((e) => e.account === "branches" || e.account === "bills"), name).toBe(false);
    }
  });
});
