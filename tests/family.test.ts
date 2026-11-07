import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { checkBuyBond, reputationGate } from "../src/sim/bonds";
import { acumenFactor, ageIn, connectionsBonus, createFamily, headOf, headStat, heirsOf } from "../src/sim/family";
import { newGame } from "../src/sim/init";
import { talkAccuracy } from "../src/sim/borrowers";
import { bondOffers, lendOffers, ventureOffers } from "../src/sim/offers";
import { createRng } from "../src/sim/rng";
import { endTurn } from "../src/sim/turn";
import { applyDecision } from "../src/sim/decisions";
import { stepVentures, ventureFailureChance } from "../src/sim/ventures";
import { fixedRng, fresh, quiet } from "./helpers";

const { tuning } = gameData;
const f = tuning.family;

describe("createFamily", () => {
  it("starts with the head, each child in order, then the head's wife, their mother", () => {
    const people = createFamily(gameData, createRng(1));
    const { head, head_spouse: wife, children } = gameData.family;
    const wifeId = children.length + 2;
    expect(people[0]).toEqual({
      id: 1, house_id: 1, name: head.name, gender: head.gender, role: "line", spouse: wifeId, parents: [], origin: null, born: null,
      birth_year: head.birth_year, death_year: null, is_head: true, acumen: head.acumen, prudence: head.prudence, connections: head.connections, traits: head.traits, inexperienced_until: null,
    });
    expect(people.slice(1, -1).map((p) => [p.id, p.name, p.gender, p.birth_year, p.is_head, p.role, p.parents])).toEqual(
      children.map((c, i) => [i + 2, c.name, c.gender, c.birth_year, false, "line", [1, wifeId]]),
    );
    expect(people.at(-1)).toMatchObject({ id: wifeId, name: wife.name, gender: "f", role: "spouse", spouse: 1, born: wife.born, origin: "merchant", traits: wife.traits });
  });

  it("draws children's stats within child_stats, the same for the same seed", () => {
    for (let seed = 1; seed < 20; seed++) {
      for (const p of createFamily(gameData, createRng(seed)).filter((x) => x.parents.length)) {
        for (const v of [p.acumen, p.prudence, p.connections]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(f.child_stats.min);
          expect(v).toBeLessThanOrEqual(f.child_stats.max);
        }
      }
    }
    expect(createFamily(gameData, createRng(7))).toEqual(createFamily(gameData, createRng(7)));
  });

  it("is part of every new game", () => {
    expect(newGame(gameData, createRng(3)).people).toHaveLength(2 + gameData.family.children.length);
  });
});

describe("family helpers", () => {
  it("ageIn counts whole years, with birthdays at the start of the year", () => {
    expect(ageIn({ birth_year: 1765 }, 1815)).toBe(50);
  });

  it("headOf and heirsOf find the living head and the living heirs, oldest first", () => {
    const s = fresh();
    expect(headOf(s)!.id).toBe(1);
    expect(heirsOf(s).map((p) => p.birth_year)).toEqual([1803, 1806, 1810]);
    s.people[2]!.death_year = 1815;
    expect(heirsOf(s).map((p) => p.id)).toEqual([2, 4]);
    // Spouses and those who married out are never heirs.
    s.people[3]!.role = "left";
    expect(heirsOf(s).map((p) => p.id)).toEqual([2]);
  });

  it("headStat falls back to the neutral value when there is no living head", () => {
    const s = fresh();
    s.people[0]!.death_year = 1815;
    expect(headStat(s, "prudence", gameData)).toBe(f.neutral_stat);
  });
});

describe("Prudence: bourse talk", () => {
  it("a more prudent head hears truer talk, up to the cap", () => {
    const s = newGame(gameData, createRng(4));
    const accuracy = (prudence: number) => {
      s.people[0]!.prudence = prudence;
      return talkAccuracy(headStat(s, "prudence", gameData), gameData);
    };
    expect(accuracy(9)).toBeGreaterThan(accuracy(5));
    expect(accuracy(5)).toBeGreaterThan(accuracy(1));
    expect(accuracy(10)).toBeLessThanOrEqual(gameData.credit.info.talk.max);
  });
});

describe("Acumen: venture failure", () => {
  it("scales failure risk: 1 at neutral, lower above, higher below", () => {
    expect(acumenFactor(f.neutral_stat, tuning)).toBe(1);
    expect(acumenFactor(10, tuning)).toBeCloseTo(0.75);
    expect(acumenFactor(1, tuning)).toBeCloseTo(1.2);
    expect(ventureFailureChance(0.2, "calm", tuning, 10, 1)).toBeCloseTo(0.15);
  });

  it("is shown in venture offers and decides venture rolls in End Turn", () => {
    const s = fresh();
    s.people[0]!.acumen = 10;
    const mill = ventureOffers(s, gameData).find((o) => o.id === "mill")!;
    const millType = gameData.ventures.find((v) => v.id === "mill")!;
    expect(mill.failure_chance).toBeCloseTo(millType.failure_risk * acumenFactor(10, tuning));
    // While it is built, the risk is spread over its calls: 1 - (1 - risk)^(1 / calls) a quarter. A roll
    // halfway between a neutral head's quarterly risk and an able one's survives for the able head only (A3).
    const quarterly = (risk: number) => 1 - Math.pow(1 - risk, 1 / millType.calls);
    const roll = (quarterly(millType.failure_risk) + quarterly(millType.failure_risk * acumenFactor(10, tuning))) / 2;
    const resolve = (acumen: number) => {
      const s0 = fresh();
      s0.people[0]!.acumen = acumen;
      const r = applyDecision(s0, { kind: "invest_venture", venture: "mill", amount: 10000 }, gameData);
      if (!r.ok) throw new Error(r.reason);
      stepVentures(r.state, fixedRng(roll, 0.999999), gameData);
      return r.state.ventures[0]!.status;
    };
    expect(resolve(10)).toBe("active");
    expect(resolve(f.neutral_stat)).toBe("failed");
  });
});

describe("Connections: access to state bonds", () => {
  it("lowers every state's reputation gate by connections_step a point above neutral", () => {
    const s = fresh();
    const prussia = gameData.states.find((st) => st.id === "prussia")!;
    expect(connectionsBonus(f.neutral_stat, tuning)).toBe(0);
    expect(reputationGate(s, prussia, gameData)).toBe(prussia.min_reputation);
    s.people[0]!.connections = 8;
    expect(reputationGate(s, prussia, gameData)).toBe(prussia.min_reputation - 3 * f.connections_step);
  });

  it("opens Prussia's bonds to a well-connected head at reputation 50", () => {
    const s = fresh();
    const buy = { kind: "buy_bond", state: "prussia", face_value: 10000 } as const;
    expect(checkBuyBond(s, buy, gameData)).toMatch(/reputation 55 or more/);
    expect(bondOffers(s, gameData).find((o) => o.id === "prussia")!.blocked).toBe("Needs reputation 55");
    s.people[0]!.connections = 8;
    expect(checkBuyBond(s, buy, gameData)).toBeNull();
    expect(bondOffers(s, gameData).find((o) => o.id === "prussia")!.blocked).toBeNull();
  });

  it("raises the gate for a poorly connected head", () => {
    const s = fresh();
    s.people[0]!.connections = 2;
    const naples = gameData.states.find((st) => st.id === "naples")!;
    expect(reputationGate(s, naples, gameData)).toBe(naples.min_reputation + 3 * f.connections_step);
  });
});
