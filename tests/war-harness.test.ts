import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { STRATEGIES } from "../src/harness/strategies";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";

/** Plays `turns` quarters of a strategy on a seed and returns every war loan it took. */
function warLoans(name: string, seed: number, turns: number): { decisions: Decision[]; state: GameState } {
  const rng = createRng(seed);
  let s = newGame(gameData, rng);
  const decisions: Decision[] = [];
  for (let t = 0; t < turns && s.house.status !== "bankrupt"; t++) {
    const ds = STRATEGIES[name]!(s, gameData);
    decisions.push(...ds.filter((d) => d.kind === "subscribe_war_loan"));
    s = endTurn(s, ds, rng, gameData);
  }
  return { decisions, state: s };
}

describe("harness strategies and war loans", () => {
  it("aggressive lends to the Hundred Days loans from the first quarter", () => {
    const { decisions, state } = warLoans("aggressive", 1, 4);
    expect(decisions.length).toBeGreaterThan(0);
    expect(state.war.loans.some((l) => l.offer === "prussia-1815" || l.offer === "austria-1815")).toBe(true);
  });

  it("bond_heavy never lends to put down a rising, and cautious never lends at all", () => {
    const repression = new Set(gameData.war.campaigns.flatMap((c) => c.offers).filter((o) => o.repression).map((o) => o.id));
    const bonds = warLoans("bond_heavy", 2, 144).decisions;
    expect(bonds.every((d) => d.kind === "subscribe_war_loan" && !repression.has(d.offer))).toBe(true);
    expect(warLoans("cautious", 2, 144).decisions).toEqual([]);
  }, 60000);
});
