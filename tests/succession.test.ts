import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { headOf, headStat, heirsOf, isTrained, quarterlyDeathChance, resolveFamily, succeed, successor, yearlyDeathChance } from "../src/sim/family";
import { runOver } from "../src/sim/actions";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import type { GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const { tuning } = gameData;
const f = tuning.family;
const sc = f.succession;
const CALM = 0.999999;

/** A house in `year`, with the given heirs' stats (all three set to `stat`) and ages. */
function house(year: number, heirs: { age: number; stat: number }[]): GameState {
  const s = fresh();
  s.world.year = year;
  s.people = [s.people[0]!, ...heirs.map((h, i) => ({ ...s.people[1]!, id: i + 2, name: `Heir ${i + 2}`, birth_year: year - h.age, acumen: h.stat, prudence: h.stat, connections: h.stat }))];
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

describe("births", () => {
  it("at year end, a head of age with room for heirs may have a child, born the next year", () => {
    const s = house(1830, [{ age: 5, stat: 2 }]);
    s.people[0]!.birth_year = 1795; // the head is 35
    s.world.quarter = 4;
    resolveFamily(s, fixedRng(0, 0.5, 0.5, 0.5), quiet);
    const baby = s.people.at(-1)!;
    expect(baby).toMatchObject({ name: `${gameData.family.child_names[0]} ${gameData.family.surname}`, birth_year: 1831, is_head: false, death_year: null });
  });

  it("no birth outside year end, for a head too old or young, or with max_heirs already", () => {
    const tryBirth = (headAge: number, quarter: 1 | 4, heirs: number) => {
      const s = house(1830, Array.from({ length: heirs }, () => ({ age: 5, stat: 2 })));
      s.people[0]!.birth_year = 1830 - headAge;
      s.world.quarter = quarter;
      const before = s.people.length;
      resolveFamily(s, fixedRng(0.999999, 0), quiet);
      return s.people.length - before;
    };
    expect(tryBirth(35, 1, 1)).toBe(0);
    expect(tryBirth(f.births.max_head_age + 1, 4, 1)).toBe(0);
    expect(tryBirth(f.births.min_head_age - 1, 4, 1)).toBe(0);
    expect(tryBirth(35, 4, f.births.max_heirs)).toBe(0);
  });

  it("is in the news", () => {
    const s0 = house(1830, [{ age: 5, stat: 2 }]);
    s0.people[0]!.birth_year = 1795;
    s0.world.quarter = 4;
    // Rolls: the mood, the random-event roll, the birth roll and three stat rolls.
    const s1 = endTurn(s0, [], fixedRng(CALM, CALM, 0, 0.5, 0.5, 0.5, CALM), quiet);
    const born = s1.news.find((n) => n.kind === "family" && n.text.startsWith(`A child, ${gameData.family.child_names[0]} Adler, is born to the house.`));
    expect(born?.text).toMatch(/The nurse already calls the child [a-z-]+\.$/);
  });
});

describe("birth names", () => {
  it("never repeat a name already in the family", () => {
    const s = house(1830, []);
    s.people[0]!.birth_year = 1795;
    s.world.quarter = 4;
    // The head is 35, so there is no death roll: the first roll is the birth roll (0: a birth).
    for (let i = 0; i < 3; i++) resolveFamily(s, fixedRng(0), quiet);
    const names = s.people.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(1)).toEqual(gameData.family.child_names.slice(0, 3).map((n) => `${n} Adler`));
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
