import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { reputationGate } from "../src/sim/bonds";
import { applyDecisions } from "../src/sim/decisions";
import { createFamily, effectiveStat, headStat, investCost, isTrained, quarterlyDeathChance, resolveFamily, successor } from "../src/sim/family";
import { lendOffers, ventureOffers } from "../src/sim/offers";
import { endTurn } from "../src/sim/turn";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { birthTrait, checkTraitData, drawTrait, openTraits, traitEffects } from "../src/sim/traits";
import type { GameData } from "../src/sim/tuning";
import { fixedRng, fresh, noDefaults, quiet } from "./helpers";

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
    s.people[0]!.traits = ["prudent", "aloof"];
    s.people[0]!.birth_year = 1785; // 30 in 1815
    s.world.quarter = 4;
    // Birth roll, three stat rolls, then the inherit roll (passes) and the pick.
    resolveFamily(s, fixedRng(0, 0.5, 0.5, 0.5, 0, 0), quiet);
    expect(s.people[1]!.traits).toEqual(["prudent"]);
  });

  it("saves keep traits and refuse a person without them", () => {
    const s = fresh();
    s.people[0]!.traits = ["prudent", "aloof"];
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.people[0]!.traits).toEqual(["prudent", "aloof"]);
    const raw = JSON.parse(toSave(s, 1, 1, []));
    delete raw.state.people[1].traits;
    const bad = parseSave(JSON.stringify(raw), gameData);
    expect(bad.ok ? null : bad.reason).toBe("Save file has a person without traits");
  });
});

describe("traits acting on the business (the head's traits only)", () => {
  const withHead = (...traits: string[]) => {
    const s = fresh();
    s.people[0]!.traits = traits;
    return s;
  };

  it("stat effects change the head's working stats, within 1 to 10", () => {
    expect(headStat(withHead("prudent"), "prudence", gameData)).toBe(7);
    expect(headStat(withHead("aloof"), "connections", gameData)).toBe(3);
    const s = withHead("shrewd");
    s.people[0]!.acumen = 9;
    expect(headStat(s, "acumen", gameData)).toBe(10);
    s.people[0]!.traits = ["reckless"];
    s.people[0]!.prudence = 2;
    expect(effectiveStat(s.people[0]!, "prudence", gameData)).toBe(1);
  });

  it("an aloof head faces higher bond gates; a prudent one sees narrower borrower estimates", () => {
    const prussia = gameData.states.find((st) => st.id === "prussia")!;
    expect(reputationGate(withHead("aloof"), prussia, gameData)).toBe(prussia.min_reputation + 2 * gameData.tuning.family.connections_step);
    const width = (s: ReturnType<typeof fresh>) => { const o = lendOffers(s, gameData)[0]!; return o.estimate.high - o.estimate.low; };
    expect(width(withHead("prudent"))).toBeLessThan(width(withHead()));
  });

  it("a gambler's ventures fail more often", () => {
    const mill = (s: ReturnType<typeof fresh>) => ventureOffers(s, gameData).find((o) => o.id === "mill")!.failure_chance;
    // Gambler: acumen +1 (factor 0.95) and failure x1.3.
    expect(mill(withHead("gambler"))).toBeCloseTo(mill(withHead()) * 0.95 * 1.3);
  });

  it("a sickly head is likelier to die; a hale one less", () => {
    const base = quarterlyDeathChance(65, gameData.tuning, 1);
    expect(quarterlyDeathChance(65, gameData.tuning, traitEffects({ traits: ["sickly"] }, gameData).death_chance)).toBeGreaterThan(base);
    expect(quarterlyDeathChance(65, gameData.tuning, traitEffects({ traits: ["hale"] }, gameData).death_chance)).toBeLessThan(base);
  });

  it("depositors withdraw less from a charismatic head", () => {
    const run = (...traits: string[]) => {
      const s = withHead(...traits);
      s.world.sentiment = "panic";
      return endTurn(s, [], noDefaults, quiet).house.deposits;
    };
    expect(run("charismatic")).toBeGreaterThan(run());
  });

  it("a spendthrift pays more for the family, a frugal head less", () => {
    const cost = gameData.tuning.family.invest.charity.cost;
    expect(investCost("charity", withHead("spendthrift"), gameData)).toBe(Math.round(cost * 1.5));
    expect(investCost("charity", withHead("frugal"), gameData)).toBe(Math.round(cost * 0.75));
    const s = withHead("spendthrift");
    const after = applyDecisions(s, [{ kind: "invest_family", form: "charity" }], gameData);
    expect(after.ok && s.house.cash - after.state.house.cash).toBe(Math.round(cost * 1.5));
  });

  it("reputation gains are scaled by the head's traits, losses are not", () => {
    const gain = gameData.tuning.family.invest.charity.reputation;
    const charity = (...traits: string[]) => {
      const r = applyDecisions(withHead(...traits), [{ kind: "invest_family", form: "charity" }], gameData);
      return r.ok ? r.state.house.reputation - 50 : NaN;
    };
    expect(charity()).toBe(gain);
    expect(charity("charismatic")).toBe(Math.round(gain * 1.5));
    expect(charity("aloof")).toBe(Math.round(gain * 0.75));
    const ev = (delta: number): GameData => ({ ...quiet, events: [{ id: "e", title: "E", text: "E.", historical: true, year: 1815, quarter: 2, conditions: {}, effects: [{ kind: "reputation", delta }] }] });
    expect(endTurn(withHead("charismatic"), [], fixedRng(0.999999), ev(4)).house.reputation).toBe(56);
    expect(endTurn(withHead("charismatic"), [], fixedRng(0.999999), ev(-4)).house.reputation).toBe(46);
  });

  it("training and the choice of successor count traits", () => {
    const s = fresh();
    s.world.year = 1830;
    const [a, b] = [s.people[1]!, s.people[2]!];
    Object.assign(a, { birth_year: 1800, acumen: 3, prudence: 3, connections: 4, traits: [] });
    Object.assign(b, { birth_year: 1805, acumen: 3, prudence: 3, connections: 4, traits: ["shrewd"] });
    s.people[3]!.death_year = 1829;
    expect(isTrained(a, 1830, gameData)).toBe(false);
    expect(isTrained(b, 1830, gameData)).toBe(true);
    expect(successor(s, gameData)!.id).toBe(b.id);
  });
});
