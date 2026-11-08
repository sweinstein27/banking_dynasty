import { describe, expect, it } from "vitest";
import { AMBITION_TASTE, legacyMakers, pickAmbition } from "../src/harness/systems/legacy";
import { STRATEGIES } from "../src/harness/strategies";
import type { Bond, GameState } from "../src/sim/types";
import { fresh, quiet } from "./helpers";

function offering(...ids: string[]): GameState {
  const s = fresh();
  s.legacy.offers = ids;
  s.legacy.offers_era = 0;
  return s;
}

function worthy(): GameState {
  const s = fresh();
  s.house.reputation = 70;
  s.house.cash = 200_000;
  const b: Bond = { id: 1, issuer_state: "austria", face_value: 20_000, coupon: 0.05, price: 1, risk: 0.25, purchase_turn: 1, status: "active" };
  s.bonds.push(b);
  return s;
}

describe("legacy harness makers", () => {
  it("gives every contender a taste, and idle none", () => {
    for (const name of Object.keys(STRATEGIES)) if (name !== "idle") expect(AMBITION_TASTE[name]).toBeDefined();
    expect(pickAmbition("idle", offering("fortune_1"), quiet)).toBeNull();
  });

  it("picks the strategy's favourite kind, else the first offered", () => {
    const s = offering("fortune_1", "standing_1", "alliance_1");
    expect(pickAmbition("cautious", s, quiet)).toBe("standing_1");
    expect(pickAmbition("aggressive", s, quiet)).toBe("fortune_1");
    expect(pickAmbition("venture_heavy", offering("standing_1", "alliance_1"), quiet)).toBe("standing_1");
  });

  it("cautious and cautious_no_family choose alike", () => {
    expect(AMBITION_TASTE.cautious).toEqual(AMBITION_TASTE.cautious_no_family);
  });

  it("chooses early and petitions late, when the house qualifies", () => {
    const s = worthy();
    const m = legacyMakers("cautious", s, quiet);
    expect(m.early.map((f) => f(s)?.kind)).toEqual(["choose_ambition"]);
    expect(m.late.map((f) => f(s))).toEqual([{ kind: "petition_title", rank: 1, grantor: "austria" }]);
  });

  it("does not petition for aggressive or idle, or when the fee is over 10% of free cash", () => {
    const s = worthy();
    expect(legacyMakers("aggressive", s, quiet).late).toEqual([]);
    expect(legacyMakers("idle", s, quiet)).toEqual({ early: [], late: [] });
    s.house.reserve = s.house.cash - 20_000;
    expect(legacyMakers("cautious", s, quiet).late[0]!(s)).toBeNull();
  });
});
