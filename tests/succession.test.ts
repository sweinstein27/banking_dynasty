import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { headOf, headStat, heirsOf, isTrained, person, quarterlyDeathChance, resolveFamily, succeed, successor, yearlyDeathChance } from "../src/sim/family";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { addSpouse, fixedRng, fresh, quiet } from "./helpers";

const { tuning } = gameData;
const f = tuning.family;
const sc = f.succession;
const CALM = 0.999999;

/** A house in `year`, with the given heirs' stats (all three set to `stat`) and ages. The head is unmarried. */
function house(year: number, heirs: { age: number; stat: number }[]): GameState {
  const s = fresh();
  s.world.year = year;
  s.people = [{ ...s.people[0]!, spouse: null }, ...heirs.map((h, i) => ({ ...s.people[1]!, id: i + 2, name: `Heir ${i + 2}`, birth_year: year - h.age, acumen: h.stat, prudence: h.stat, connections: h.stat }))];
  return s;
}

describe("death chances", () => {
  it("is zero before from_age and rises a little each year after", () => {
    expect(yearlyDeathChance(f.death.from_age - 1, tuning)).toBe(0);
    expect(yearlyDeathChance(f.death.from_age, tuning)).toBeCloseTo(f.death.base);
    expect(yearlyDeathChance(60, tuning)).toBeCloseTo(f.death.base + 5 * f.death.per_year);
    expect(yearlyDeathChance(200, tuning)).toBe(1);
  });

  it("splits the yearly chance into four quarters", () => {
    const q = quarterlyDeathChance(65, tuning, 1);
    expect(1 - Math.pow(1 - q, 4)).toBeCloseTo(yearlyDeathChance(65, tuning));
  });

  it("draws no death roll for a head younger than from_age", () => {
    let calls = 0;
    resolveFamily(fresh(), { next: () => (calls++, 0) }, quiet);
    expect(calls).toBe(0);
  });
});

describe("choosing the successor", () => {
  it("prefers a trained heir over a better-stat child", () => {
    const s = house(1830, [{ age: 25, stat: 4 }, { age: 15, stat: 9 }]);
    expect(successor(s, gameData)!.name).toBe("Heir 2");
  });

  it("among the trained, the highest stat total, then the eldest", () => {
    expect(successor(house(1830, [{ age: 30, stat: 4 }, { age: 25, stat: 6 }]), gameData)!.name).toBe("Heir 3");
    expect(successor(house(1830, [{ age: 25, stat: 5 }, { age: 30, stat: 5 }]), gameData)!.name).toBe("Heir 3");
  });

  it("with no trained heir, the best untrained one", () => {
    expect(successor(house(1830, [{ age: 12, stat: 2 }, { age: 10, stat: 3 }]), gameData)!.name).toBe("Heir 3");
  });

  it("training needs adulthood and a stat total of at least trained_total", () => {
    const s = house(1830, [{ age: sc.adult_age, stat: 4 }, { age: sc.adult_age - 1, stat: 9 }, { age: 40, stat: 3 }]);
    const [adult, minor, weak] = heirsOf(s).sort((a, b) => a.id - b.id);
    expect(isTrained(adult!, 1830, gameData)).toBe(true);
    expect(isTrained(minor!, 1830, gameData)).toBe(false);
    expect(isTrained(weak!, 1830, gameData)).toBe(false);
  });
});

describe("succession", () => {
  it("a trained heir takes over at a small reputation cost, with stats acting at once", () => {
    const s = house(1830, [{ age: 27, stat: 7 }]);
    succeed(s, quiet);
    expect(s.people[0]).toMatchObject({ death_year: 1830, is_head: false });
    expect(headOf(s)!.name).toBe("Heir 2");
    expect(s.house.reputation).toBe(50 - sc.reputation_trained);
    expect(headStat(s, "prudence", gameData)).toBe(7);
    expect(s.successions).toEqual([{ turn: 1, from: 1, to: 2, trained: true, named: false, passed_over: null }]);
  });

  it("an untrained heir costs more reputation and acts weaker for inexperience_quarters", () => {
    const s = house(1830, [{ age: 14, stat: 3 }]);
    succeed(s, quiet);
    expect(s.house.reputation).toBe(50 - sc.reputation_untrained);
    expect(headStat(s, "acumen", gameData)).toBe(Math.max(1, 3 - sc.inexperience_penalty));
    s.world.turn += sc.inexperience_quarters;
    expect(headStat(s, "acumen", gameData)).toBe(3);
  });

  it("with no heir left, a distant cousin takes over, untrained", () => {
    const s = house(1830, []);
    succeed(s, quiet);
    const cousin = headOf(s)!;
    expect(cousin).toMatchObject({ name: gameData.family.cousin.name, birth_year: 1830 - gameData.family.cousin.age, acumen: sc.cousin_stat });
    expect(s.successions[0]!.trained).toBe(false);
    expect(s.house.reputation).toBe(50 - sc.reputation_untrained);
  });

  it("reputation never falls below zero", () => {
    const s = house(1830, []);
    s.house.reputation = 3;
    succeed(s, quiet);
    expect(s.house.reputation).toBe(0);
  });
});

describe("a head dying mid-year, in End Turn", () => {
  it("succeeds in the same quarter, and the heir's stats act from the next one", () => {
    // 1830 Q2: Johann is 65. Rolls: the mood, the random-event roll, then the death roll (0: dies).
    const s0 = house(1830, [{ age: 27, stat: 8 }]);
    s0.world.quarter = 2;
    const s1 = endTurn(s0, [], fixedRng(CALM, CALM, 0, CALM), quiet);
    expect(s1.world).toMatchObject({ year: 1830, quarter: 3 });
    expect(headOf(s1)!.name).toBe("Heir 2");
    expect(headStat(s1, "connections", gameData)).toBe(8);
    const news = s1.news.find((n) => n.kind === "family")!;
    expect(news.text).toBe("Johann Adler has died, aged 65. Heir 2, aged 27, takes over the house.");
  });

  it("a child heir is named untrained in the news", () => {
    const s0 = house(1830, [{ age: 9, stat: 2 }]);
    const s1 = endTurn(s0, [], fixedRng(CALM, CALM, 0, CALM), quiet);
    expect(s1.news.find((n) => n.kind === "family")!.text).toMatch(/Heir 2, aged 9, takes over the house\. Untrained and unready/);
  });

  it("the head can die and the business carries on through the rest of the run", () => {
    let s = house(1830, [{ age: 27, stat: 6 }]);
    s = endTurn(s, [], fixedRng(CALM, CALM, 0, CALM), quiet);
    for (let i = 0; i < 8; i++) s = endTurn(s, [], fixedRng(CALM), quiet);
    expect(s.house.status).toBe("solvent");
    expect(s.successions).toHaveLength(1);
  });
});

/** A house in 1830 Q4 with one young heir and a head of 35, married to a wife of `wifeAge`. */
function married(wifeAge = 30) {
  const s = house(1830, [{ age: 5, stat: 2 }]);
  s.people[0]!.birth_year = 1795;
  s.world.quarter = 4;
  const wife = addSpouse(s, 1, 1830 - wifeAge);
  return { s, wife };
}

describe("births", () => {
  const { m: boys, f: girls } = gameData.family.child_names;

  it("at year end, a married couple of the line may have a child, born the next year", () => {
    const { s, wife } = married();
    // Rolls: the birth (0: a child), the gender (0.5: a girl), three stats.
    resolveFamily(s, fixedRng(0, 0.5, 0.5, 0.5, 0.5), quiet);
    expect(s.people.at(-1)).toMatchObject({ name: `${girls[0]} ${gameData.family.surname}`, gender: "f", role: "line", parents: [1, wife.id], birth_year: 1831, is_head: false, death_year: null });
    expect(heirsOf(s).map((p) => p.name)).toContain(`${girls[0]} Adler`);
  });

  it("no child without a living spouse: an unmarried head, or a widower", () => {
    const single = house(1830, [{ age: 5, stat: 2 }]);
    single.people[0]!.birth_year = 1795;
    single.world.quarter = 4;
    let draws = 0;
    resolveFamily(single, { next: () => (draws++, 0) }, quiet);
    expect(draws).toBe(0);
    const { s, wife } = married();
    wife.death_year = 1829;
    const before = s.people.length;
    resolveFamily(s, fixedRng(0), quiet);
    expect(s.people.length).toBe(before);
  });

  it("no birth outside year end, for a wife too old or too young, or with max_heirs already", () => {
    const tryBirth = (wifeAge: number, quarter: 1 | 4, heirs = 1) => {
      const s = house(1830, Array.from({ length: heirs }, () => ({ age: 5, stat: 2 })));
      s.people[0]!.birth_year = 1795;
      addSpouse(s, 1, 1830 - wifeAge);
      s.world.quarter = quarter;
      const before = s.people.length;
      resolveFamily(s, fixedRng(0), quiet);
      return s.people.length - before;
    };
    expect(tryBirth(30, 4)).toBe(1);
    expect(tryBirth(30, 1)).toBe(0);
    expect(tryBirth(f.births.max_mother_age + 1, 4)).toBe(0);
    expect(tryBirth(f.births.min_mother_age - 1, 4)).toBe(0);
    expect(tryBirth(30, 4, f.births.max_heirs)).toBe(0);
  });

  it("an heir's marriage brings grandchildren, who are heirs too", () => {
    const s = house(1830, [{ age: 25, stat: 4 }]);
    s.world.quarter = 4;
    const heir = s.people[1]!;
    heir.gender = "m";
    const wife = addSpouse(s, heir.id, 1808);
    // Rolls: no death roll (head 65 has one: survives), then the heir's couple: birth, gender (boy), stats.
    resolveFamily(s, fixedRng(CALM, 0, 0, 0.5, 0.5, 0.5), quiet);
    const child = s.people.at(-1)!;
    expect(child).toMatchObject({ name: `${boys[0]} Adler`, parents: [heir.id, wife.id], role: "line" });
    expect(heirsOf(s).map((p) => p.id)).toEqual([heir.id, child.id]);
  });

  it("a grandchild can inherit, and with no one left of the line the cousin takes over", () => {
    const s = house(1830, [{ age: 25, stat: 4 }]);
    const heir = s.people[1]!;
    s.people.push({ ...person(3, "Grandchild Adler", "f", 1825, "line"), parents: [heir.id] });
    heir.death_year = 1829;
    succeed(s, quiet);
    expect(headOf(s)!.name).toBe("Grandchild Adler");
    const t = house(1830, []);
    t.people.push({ ...person(2, "Spouse", "f", 1790, "spouse"), spouse: 1 });
    succeed(t, quiet);
    expect(headOf(t)!.name).toBe(gameData.family.cousin.name);
  });

  it("spouses of the line can die, by the same rule as heads", () => {
    const { s, wife } = married(70);
    s.world.quarter = 1;
    // Rolls: the spouse's death roll (0: dies).
    resolveFamily(s, fixedRng(0), quiet);
    expect(wife.death_year).toBe(1830);
    expect(headOf(s)!.id).toBe(1);
  });

  it("is in the news", () => {
    const { s: s0 } = married();
    // Rolls: the mood, the random-event roll, the birth roll, the gender (a girl) and three stat rolls.
    const s1 = endTurn(s0, [], fixedRng(CALM, CALM, 0, 0.5, 0.5, 0.5, 0.5, CALM), quiet);
    const born = s1.news.find((n) => n.kind === "family" && n.text.startsWith(`A child, ${girls[0]} Adler, is born to the house.`));
    expect(born?.text).toMatch(/The nurse already calls the child [a-z-]+\.$/);
  });
});

describe("birth names", () => {
  it("never repeat a name already in the family", () => {
    const { s } = married();
    // Each birth: the birth roll (0), the gender (0: a boy), stats and traits all 0.
    for (let i = 0; i < 3; i++) resolveFamily(s, fixedRng(0), quiet);
    const names = s.people.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(-3)).toEqual(gameData.family.child_names.m.slice(0, 3).map((n) => `${n} Adler`));
  });
});

describe("full runs with the real data", () => {
  it("always have exactly one living head, and the founder usually dies before 1850", () => {
    let founderDied = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      let s = newGame(gameData, rng);
      while (!runOver(s, tuning)) {
        s = endTurn(s, [], rng, gameData);
        expect(s.people.filter((p) => p.is_head && p.death_year === null), `seed ${seed} turn ${s.world.turn}`).toHaveLength(1);
      }
      if (s.successions.length > 0) founderDied++;
    }
    // From 50 in 1815 to 85 in 1850 the chance of surviving is about 0.01%.
    expect(founderDied).toBeGreaterThanOrEqual(18);
  });
});
