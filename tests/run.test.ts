import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { runOver } from "../src/sim/actions";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { endTurn } from "../src/sim/turn";
import type { GameState, Quarter } from "../src/sim/types";
import { fresh, noDefaults, quiet } from "./helpers";

const { tuning } = gameData;

function at(year: number, quarter: Quarter): GameState {
  const s = fresh();
  s.world.year = year;
  s.world.quarter = quarter;
  return s;
}

describe("runOver", () => {
  it("is null for a new game", () => {
    expect(runOver(fresh(), tuning)).toBeNull();
  });

  it("is null while the last quarter is still to be played", () => {
    expect(runOver(at(tuning.end.year, tuning.end.quarter), tuning)).toBeNull();
  });

  it("is finished once the last quarter has been played", () => {
    const last = at(tuning.end.year, tuning.end.quarter);
    const after = endTurn(last, [], noDefaults, gameData);
    expect(runOver(after, tuning)).toBe("finished");
  });

  it("is bankrupt for a bankrupt house, even after the end date", () => {
    const s = at(tuning.end.year + 1, 1);
    s.house.status = "bankrupt";
    expect(runOver(s, tuning)).toBe("bankrupt");
  });

  it("ends a full run from 1815 Q1 to 1850 Q4 after 144 turns", () => {
    let s = fresh();
    let turns = 0;
    while (!runOver(s, tuning)) {
      // A2: the quiet counting house, so an idle house's wages do not bankrupt it.
      s = endTurn(s, [], noDefaults, { ...gameData, counting: quiet.counting });
      turns++;
    }
    expect(turns).toBe(144);
    expect(s.world).toMatchObject({ turn: 145, year: 1851, quarter: 1 });
  });
});

describe("a finished run", () => {
  const done = endTurn(at(tuning.end.year, tuning.end.quarter), [], noDefaults, gameData);

  it("refuses End Turn", () => {
    expect(() => endTurn(done, [], noDefaults, gameData)).toThrow(/run is over/);
  });

  it("refuses every decision", () => {
    const r = applyDecision(done, { kind: "set_reserve", amount: 5000 }, gameData);
    expect(r).toEqual({ ok: false, reason: "The run is over" });
  });
});
