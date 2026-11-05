import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { cloneState } from "../src/sim/state";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fresh } from "./helpers";
import { aggressiveDecisions, economyDecisions } from "./strategies";

/** Freezes every entry of the add-only histories, so any later change to one throws. */
function freezeHistories(s: GameState): void {
  for (const list of [s.ledger, s.news, s.fired_events, s.successions, s.year_ends] as object[][]) list.forEach((e) => Object.freeze(e));
}

describe("cloneState", () => {
  it("copies deeply everything a sim function changes", () => {
    const s = fresh();
    const c = cloneState(s);
    c.house.cash = 1;
    c.people[0]!.acumen = 9;
    c.borrowers[0]!.reported = true;
    expect(s.house.cash).toBe(100000);
    expect(s.people[0]!.acumen).toBe(5);
    expect(s.borrowers[0]!.reported).toBe(false);
  });

  it("gives the histories new lists, so adding to one leaves the original alone", () => {
    const s = fresh();
    const c = cloneState(s);
    c.ledger.push({ ...c.ledger[0]! });
    c.news.push({ turn: 1, kind: "mood", text: "x" });
    expect(s.ledger).toHaveLength(2);
    expect(s.news).toHaveLength(0);
  });

  it("is never undone by a sim function changing a written entry: whole runs with frozen histories", () => {
    for (const [seed, strategy] of [[3, economyDecisions], [159, aggressiveDecisions]] as const) {
      const rng = createRng(seed);
      let s = newGame(gameData, rng);
      while (!runOver(s, gameData.tuning)) {
        freezeHistories(s);
        s = endTurn(s, strategy(s), rng, gameData);
      }
      expect(s.world.turn).toBeGreaterThan(1);
    }
  });
});
