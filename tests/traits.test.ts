import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { createFamily, resolveFamily } from "../src/sim/family";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { birthTrait, checkTraitData, drawTrait, openTraits, traitEffects } from "../src/sim/traits";
import type { GameData } from "../src/sim/tuning";
import { fixedRng, fresh, quiet } from "./helpers";

const withTraits = (traits: GameData["traits"]): GameData => ({ ...gameData, traits });

describe("checkTraitData", () => {
  it("finds no problems in data/traits.json and the family's traits", () => {
    expect(checkTraitData(gameData)).toEqual([]);
  });

  it("reports unknown effects, one-sided opposites, bad multipliers and missing virtues", () => {
    const bad = withTraits([
      { id: "a", name: "A", description: "A.", opposite: "b", virtue_for: "acumen", effects: { charm: 1 } as never },
      { id: "b", name: "B", description: "B.", effects: { death_chance: 0 } },
    ]);
    expect(checkTraitData(bad)).toEqual(expect.arrayContaining([
      'a: unknown effect "charm"',
      'a: opposite "b" does not name it back',
      "b: death_chance must be above zero",
      "stat prudence: needs exactly one virtue",
      'founder: unknown trait "prudent"',
    ]));
  });
});

describe("drawing traits", () => {
  it("never offers a trait already held or the opposite of one held", () => {
    const open = openTraits(["prudent", "hale"], gameData).map((t) => t.id);
    for (const id of ["prudent", "reckless", "hale", "sickly"]) expect(open).not.toContain(id);
    expect(open).toContain("shrewd");
  });

  it("draws from the open traits, and gives none when none is open", () => {
    expect(drawTrait([], fixedRng(0), gameData)).toBe(gameData.traits[0]!.id);
    expect(drawTrait(gameData.traits.map((t) => t.id), fixedRng(0), gameData)).toBeNull();
  });

  it("a newborn inherits one of the parent's traits with inherit_chance, else draws at random", () => {
    const below = gameData.tuning.family.traits.inherit_chance - 0.01;
    // Inherit roll passes, then 0.99 picks the parent's last open trait.
    expect(birthTrait(["prudent", "aloof"], fixedRng(below, 0.99), gameData)).toBe("aloof");
    // Inherit roll fails, then the first trait in the data is drawn.
    expect(birthTrait(["prudent", "aloof"], fixedRng(0.99, 0), gameData)).toBe(gameData.traits[0]!.id);
  });
});

describe("traitEffects", () => {
  it("adds stat effects and multiplies the rest", () => {
    const e = traitEffects({ traits: ["aloof", "charismatic", "gambler"] }, gameData);
    expect(e.connections).toBe(-2);
    expect(e.acumen).toBe(1);
    expect(e.reputation_gain).toBeCloseTo(0.75 * 1.5);
    expect(e.withdrawals).toBeCloseTo(0.85);
    expect(e.venture_failure).toBeCloseTo(1.3);
    expect(e.death_chance).toBe(1);
  });

  it("is neutral for a person with no traits, and ignores unknown ids", () => {
    expect(traitEffects({ traits: ["no-such-trait"] }, gameData)).toEqual({
      acumen: 0, prudence: 0, connections: 0, death_chance: 1, venture_failure: 1, withdrawals: 1, family_cost: 1, reputation_gain: 1,
    });
  });
});

describe("the family's traits", () => {
  it("the founder starts with the traits in data/family.json; each child with one drawn trait", () => {
    const people = createFamily(gameData, createRng(4));
    expect(people[0]!.traits).toEqual(["prudent", "aloof"]);
    for (const child of people.slice(1)) {
      expect(child.traits).toHaveLength(1);
      expect(gameData.traits.some((t) => t.id === child.traits[0])).toBe(true);
    }
    expect(createFamily(gameData, createRng(4))).toEqual(people);
  });

  it("a newborn gets a trait", () => {
    const s = fresh();
    s.people = [s.people[0]!];
    s.people[0]!.birth_year = 1785; // 30 in 1815
    s.world.quarter = 4;
    // Birth roll, three stat rolls, then the inherit roll (passes) and the pick.
    resolveFamily(s, fixedRng(0, 0.5, 0.5, 0.5, 0, 0), quiet);
    expect(s.people[1]!.traits).toEqual(["prudent"]);
  });

  it("saves keep traits and refuse a person without them", () => {
    const s = fresh();
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.people[0]!.traits).toEqual(["prudent", "aloof"]);
    const raw = JSON.parse(toSave(s, 1, 1, []));
    delete raw.state.people[1].traits;
    const bad = parseSave(JSON.stringify(raw), gameData);
    expect(bad.ok ? null : bad.reason).toBe("Save file has a person without traits");
  });
});
