import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { headOf, heirsOf, succeed } from "../src/sim/family";
import { newGame } from "../src/sim/init";
import { createRng } from "../src/sim/rng";
import {
  ambitionDef,
  answerPetition,
  checkAmbitions,
  checkLegacyData,
  createLegacy,
  drawNextOffers,
  eligibleAmbitions,
  familyPillar,
  grantChance,
  influence,
  legacyPillar,
  offeredAmbitions,
  prestige,
  resolveLegacy,
  serviceTo,
  titledName,
  titleRank,
  turnOfYear,
  wealthPillar,
} from "../src/sim/systems/legacy";
import { endTurn, netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { Bond, Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const NEVER = 0.999999;

function apply(s: GameState, d: Decision, data: GameData = quiet): GameState {
  const r = applyDecision(s, d, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function reason(s: GameState, d: Decision, data: GameData = quiet): string {
  const r = applyDecision(s, d, data);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
}

/** Moves the calendar to `year` Q`quarter` (and the turn with it). */
function at(s: GameState, year: number, quarter: 1 | 2 | 3 | 4): GameState {
  s.world.year = year;
  s.world.quarter = quarter;
  s.world.turn = turnOfYear(year, quiet.tuning) + quarter - 1;
  return s;
}

/** A game whose era-0 offers are exactly `ids`. */
function offering(...ids: string[]): GameState {
  const s = fresh();
  s.legacy.offers = ids;
  s.legacy.offers_era = 0;
  return s;
}

function bond(s: GameState, state: string, face: number): Bond {
  const b: Bond = { id: s.bonds.length + 1, issuer_state: state, face_value: face, coupon: 0.05, price: 1, risk: 0.2, purchase_turn: s.world.turn, status: "active" };
  s.bonds.push(b);
  return b;
}

/** A house fit for a "von" from Austria: reputation 70, plenty of cash, 20,000 fl. of Austrian bonds. */
function worthy(): GameState {
  const s = fresh();
  s.house.reputation = 70;
  s.house.cash = 200_000;
  bond(s, "austria", 20_000);
  return s;
}

describe("legacy data", () => {
  it("is sound", () => {
    expect(checkLegacyData(gameData)).toEqual([]);
  });

  it("has no em dashes", () => {
    expect(JSON.stringify(gameData.legacy)).not.toContain("—");
  });
});

describe("the start", () => {
  it("offers three ambitions of the first era", () => {
    const s = fresh();
    expect(s.legacy.offers_era).toBe(0);
    expect(s.legacy.offers).toHaveLength(3);
    for (const id of s.legacy.offers) expect(ambitionDef(id, quiet)!.eras).toContain(0);
  });

  it("draws the same offers for the same seed and others for other seeds", () => {
    const a = newGame(quiet, createRng(5)).legacy.offers;
    expect(newGame(quiet, createRng(5)).legacy.offers).toEqual(a);
    const seen = new Set([1, 2, 3, 4, 6, 7, 8, 9].map((seed) => newGame(quiet, createRng(seed)).legacy.offers.join()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("draws nothing from the run's RNG", () => {
    const off: GameData = { ...quiet, legacy: { ...quiet.legacy, enabled: false } };
    const r1 = createRng(9);
    const r2 = createRng(9);
    createLegacy(quiet, r1);
    createLegacy(off, r2);
    expect(r1.next()).toBe(r2.next());
    expect(createLegacy(off, createRng(9)).offers).toEqual([]);
  });

  it("starts with no title, no petition and influence 0", () => {
    const s = fresh();
    expect(titleRank(s)).toBe(0);
    expect(s.legacy.petition).toBeNull();
    expect(influence(s, quiet)).toBe(0);
  });
});

describe("choosing an ambition", () => {
  it("records the choice and uses none of the quarter's capacity", () => {
    const s = offering("fortune_1", "standing_1", "alliance_1");
    const next = apply(s, { kind: "choose_ambition", ambition: "fortune_1" });
    expect(next.legacy.ambitions).toEqual([{ era: 0, id: "fortune_1", chosen_turn: 1, status: "open", settled_turn: null }]);
    expect(next.counting.used).toEqual(s.counting.used);
    expect(offeredAmbitions(next, quiet)).toEqual([]);
  });

  it("refuses a second choice, one not on offer, and one after the first year", () => {
    const s = offering("fortune_1", "standing_1");
    expect(reason(s, { kind: "choose_ambition", ambition: "railway" })).toContain("not on offer");
    const chosen = apply(s, { kind: "choose_ambition", ambition: "fortune_1" });
    expect(reason(chosen, { kind: "choose_ambition", ambition: "standing_1" })).toContain("already chosen");
    const late = offering("fortune_1");
    late.world.turn = 5;
    late.world.year = 1816;
    expect(reason(late, { kind: "choose_ambition", ambition: "fortune_1" })).toContain("first 4 quarters");
  });

  it("refuses when the house is bankrupt", () => {
    const s = offering("fortune_1");
    s.house.status = "bankrupt";
    expect(reason(s, { kind: "choose_ambition", ambition: "fortune_1" })).toContain("bankrupt");
  });

  it("goes through End Turn", () => {
    const s = offering("fortune_1");
    const next = endTurn(s, [{ kind: "choose_ambition", ambition: "fortune_1" }], createRng(1), quiet);
    expect(next.legacy.ambitions[0]!.id).toBe("fortune_1");
  });
});

describe("ambitions met and missed", () => {
  it("meets a deed the quarter it is done, with its reward", () => {
    const s = apply(offering("fortune_1"), { kind: "choose_ambition", ambition: "fortune_1" });
    s.house.reputation = 50;
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("open");
    s.house.cash += 100_000;
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]).toMatchObject({ status: "met", settled_turn: 1 });
    expect(s.house.reputation).toBe(52);
    expect(s.news.at(-1)!.title).toBe("An ambition met");
  });

  it("misses a public ambition at the era's end, at a cost in reputation", () => {
    const s = apply(offering("state_loan_1"), { kind: "choose_ambition", ambition: "state_loan_1" });
    s.house.reputation = 50;
    at(s, 1819, 3);
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("open");
    at(s, 1819, 4);
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("missed");
    expect(s.house.reputation).toBe(47);
  });

  it("misses a private ambition at no cost", () => {
    const s = apply(offering("alliance_1"), { kind: "choose_ambition", ambition: "alliance_1" });
    s.house.reputation = 50;
    at(s, 1819, 4);
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("missed");
    expect(s.house.reputation).toBe(50);
  });

  it("counts only state loans won in the era", () => {
    const s = fresh();
    at(s, 1820, 1);
    s.legacy.ambitions.push({ era: 1, id: "state_loan_2", chosen_turn: s.world.turn, status: "open", settled_turn: null });
    const won = { state: "bavaria", winner: "player", status: "closed" } as GameState["finance"]["contracts"][number];
    s.finance.contracts.push({ ...won, open_turn: 10 });
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("open");
    s.finance.contracts.push({ ...won, open_turn: s.world.turn });
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("met");
  });

  it("judges a trained heir only at the era's end", () => {
    const s = fresh();
    at(s, 1820, 1);
    s.legacy.ambitions.push({ era: 1, id: "trained_heir", chosen_turn: s.world.turn, status: "open", settled_turn: null });
    const heir = heirsOf(s)[0]!;
    heir.birth_year = 1790;
    heir.acumen = heir.prudence = heir.connections = 10;
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("open");
    at(s, 1829, 4);
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("met");
  });

  it("survives the head's death mid-era", () => {
    const s = apply(offering("fortune_1"), { kind: "choose_ambition", ambition: "fortune_1" });
    at(s, 1817, 2);
    const old = headOf(s)!;
    succeed(s, quiet);
    expect(headOf(s)!.id).not.toBe(old.id);
    s.house.cash += 100_000;
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("met");
  });

  it("draws the next era's offers at an era's end, leaving out ambitions already met", () => {
    const s = fresh();
    s.house.reputation = 90;
    at(s, 1819, 4);
    drawNextOffers(s, createRng(3), quiet);
    expect(s.legacy.offers_era).toBe(1);
    expect(s.legacy.offers).toHaveLength(3);
    expect(s.legacy.offers).not.toContain("standing_1");
    expect(eligibleAmbitions(s, 1, quiet).map((a) => a.id)).not.toContain("standing_1");
    // Only the next title up is ever offered.
    expect(eligibleAmbitions(s, 2, quiet).map((a) => a.id)).toContain("ennobled");
    expect(eligibleAmbitions(s, 2, quiet).map((a) => a.id)).not.toContain("barony");
  });

  it("draws nothing after the last era", () => {
    const s = fresh();
    at(s, 1850, 4);
    s.legacy.offers = [];
    drawNextOffers(s, createRng(3), quiet);
    expect(s.legacy.offers).toEqual([]);
  });
});

describe("titles", () => {
  it("counts services: contracts won and a large holding of bonds", () => {
    const s = fresh();
    expect(serviceTo(s, "austria", quiet)).toBe(0);
    bond(s, "austria", 19_999);
    expect(serviceTo(s, "austria", quiet)).toBe(0);
    bond(s, "austria", 1);
    expect(serviceTo(s, "austria", quiet)).toBe(1);
    s.finance.contracts.push({ state: "austria", winner: "player", status: "placing", open_turn: 1 } as GameState["finance"]["contracts"][number]);
    expect(serviceTo(s, "austria", quiet)).toBe(2);
  });

  it("refuses a petition without the merits", () => {
    const s = fresh();
    s.house.cash = 200_000;
    s.house.reputation = 70;
    expect(reason(s, { kind: "petition_title", rank: 1, grantor: "austria" })).toContain("service");
    expect(reason(s, { kind: "petition_title", rank: 1, grantor: "france" })).toContain("grants no titles");
    expect(reason(s, { kind: "petition_title", rank: 2, grantor: "austria" })).toContain("rank below");
    const w = worthy();
    w.house.reputation = 59;
    expect(reason(w, { kind: "petition_title", rank: 1, grantor: "austria" })).toContain("reputation 60");
    const p = worthy();
    bond(p, "prussia", 20_000);
    p.house.reputation = 69;
    expect(reason(p, { kind: "petition_title", rank: 1, grantor: "prussia" })).toContain("reputation 70");
    const poor = worthy();
    poor.house.cash = 0;
    expect(reason(poor, { kind: "petition_title", rank: 1, grantor: "austria" })).toContain("worth");
  });

  it("refuses a petition with no cash for the fee", () => {
    const s = worthy();
    s.house.cash = 3_000;
    s.bonds[0]!.face_value = 200_000;
    expect(netWorth(s)).toBeGreaterThan(100_000);
    expect(reason(s, { kind: "petition_title", rank: 1, grantor: "austria" })).toContain("Not enough cash");
  });

  it("pays the fee, then the grant raises the house to von", () => {
    const s = worthy();
    const rep = s.house.reputation;
    const next = apply(s, { kind: "petition_title", rank: 1, grantor: "austria" });
    expect(next.house.cash).toBe(196_000);
    expect(next.ledger.at(-1)).toMatchObject({ category: "title_fee", amount: -4000 });
    expect(reason(next, { kind: "petition_title", rank: 1, grantor: "bavaria" })).toContain("awaiting");
    answerPetition(next, fixedRng(0), quiet);
    expect(titleRank(next)).toBe(1);
    expect(next.house.reputation).toBe(rep + 4);
    expect(next.legacy.petition).toBeNull();
    expect(titledName("Johann Adler", next)).toBe("Johann von Adler");
  });

  it("returns the fee on a refusal and makes the house wait", () => {
    const s = apply(worthy(), { kind: "petition_title", rank: 1, grantor: "austria" });
    answerPetition(s, fixedRng(NEVER), quiet);
    expect(titleRank(s)).toBe(0);
    expect(s.house.cash).toBe(200_000);
    expect(s.ledger.at(-1)).toMatchObject({ category: "title_fee", amount: 4000 });
    expect(reason(s, { kind: "petition_title", rank: 1, grantor: "austria" })).toContain("must wait");
    s.world.turn = s.legacy.petition_after;
    expect(applyDecision(s, { kind: "petition_title", rank: 1, grantor: "austria" }, quiet).ok).toBe(true);
  });

  it("refuses at End Turn a house that no longer qualifies, without a roll", () => {
    const s = apply(worthy(), { kind: "petition_title", rank: 1, grantor: "austria" });
    s.bonds = [];
    let rolls = 0;
    answerPetition(s, { next: () => (rolls++, 0) }, quiet);
    expect(rolls).toBe(0);
    expect(titleRank(s)).toBe(0);
  });

  it("raises the grant chance with the head's Connections", () => {
    const s = fresh();
    headOf(s)!.connections = 5;
    expect(grantChance(s, "austria", quiet)).toBeCloseTo(0.7);
    headOf(s)!.connections = 9;
    expect(grantChance(s, "austria", quiet)).toBeCloseTo(0.9);
    expect(grantChance(s, "france", quiet)).toBe(0);
  });

  it("needs von held six years before Freiherr", () => {
    const s = worthy();
    s.house.reputation = 80;
    s.house.cash = 400_000;
    bond(s, "austria", 0);
    s.finance.contracts.push({ state: "austria", winner: "player", status: "closed", open_turn: 1 } as GameState["finance"]["contracts"][number]);
    s.legacy.titles.push({ rank: 1, grantor: "austria", turn: 1 });
    s.world.turn = 24;
    expect(reason(s, { kind: "petition_title", rank: 2, grantor: "austria" })).toContain("6 years");
    s.world.turn = 25;
    const next = apply(s, { kind: "petition_title", rank: 2, grantor: "austria" });
    answerPetition(next, fixedRng(0), quiet);
    expect(titleRank(next)).toBe(2);
    expect(titledName("Johann Adler", next)).toBe("Johann Freiherr von Adler");
  });

  it("stays with the house through a succession, a cousin included", () => {
    const s = fresh();
    s.legacy.titles.push({ rank: 1, grantor: "austria", turn: 1 });
    for (const h of heirsOf(s)) h.death_year = 1815;
    succeed(s, quiet);
    expect(headOf(s)!.name).toBe(quiet.family.cousin.name);
    expect(titleRank(s)).toBe(1);
  });

  it("counts a title as an ambition met", () => {
    const s = fresh();
    at(s, 1820, 1);
    s.legacy.ambitions.push({ era: 1, id: "ennobled", chosen_turn: s.world.turn, status: "open", settled_turn: null });
    s.legacy.titles.push({ rank: 1, grantor: "austria", turn: s.world.turn });
    checkAmbitions(s, quiet);
    expect(s.legacy.ambitions[0]!.status).toBe("met");
  });
});

describe("prestige", () => {
  it("scores wealth on a log scale from 50,000 fl. to 2,000,000 fl.", () => {
    const s = fresh();
    s.house.deposits = 0;
    s.house.cash = 50_000;
    expect(wealthPillar(s, quiet)).toBe(0);
    s.house.cash = 0;
    expect(wealthPillar(s, quiet)).toBe(0);
    s.house.cash = 2_000_000;
    expect(wealthPillar(s, quiet)).toBe(100);
    s.house.cash = 5_000_000;
    expect(wealthPillar(s, quiet)).toBe(100);
    s.house.cash = Math.round(Math.sqrt(50_000 * 2_000_000));
    expect(wealthPillar(s, quiet)).toBe(50);
  });

  it("scores a bankrupt house's wealth 0, and legacy does nothing for it", () => {
    const s = apply(offering("fortune_1"), { kind: "choose_ambition", ambition: "fortune_1" });
    s.house.cash = 1_000_000;
    s.house.status = "bankrupt";
    expect(wealthPillar(s, quiet)).toBe(0);
    at(s, 1815, 4);
    const before = structuredClone(s.legacy);
    resolveLegacy(s, createRng(1), quiet);
    expect(s.legacy).toEqual(before);
  });

  it("scores family by heirs, a trained successor and allies", () => {
    const s = fresh();
    const heirs = heirsOf(s).length;
    expect(familyPillar(s, quiet)).toBe(Math.min(3, heirs) * 15);
    for (const h of heirsOf(s)) h.death_year = 1815;
    expect(familyPillar(s, quiet)).toBe(0);
    s.marriages.push({ turn: 1, member: 1, spouse: null, house: "kessler", form: "in", dowry: 0 });
    expect(familyPillar(s, quiet)).toBe(10);
  });

  it("scores legacy by title, ambitions met and listed companies, at most 100", () => {
    const s = fresh();
    expect(legacyPillar(s, quiet)).toBe(0);
    s.legacy.titles.push({ rank: 1, grantor: "austria", turn: 1 });
    s.legacy.ambitions.push({ era: 0, id: "fortune_1", chosen_turn: 1, status: "met", settled_turn: 2 });
    s.legacy.ambitions.push({ era: 1, id: "state_loan_2", chosen_turn: 21, status: "missed", settled_turn: 60 });
    expect(legacyPillar(s, quiet)).toBe(40);
    s.legacy.titles.push({ rank: 2, grantor: "austria", turn: 30 });
    for (const id of ["state_loan_2", "first_house", "branch_2", "railway"]) s.legacy.ambitions.push({ era: 2, id, chosen_turn: 1, status: "met", settled_turn: 2 });
    expect(legacyPillar(s, quiet)).toBe(100);
  });

  it("sums five pillars, influence 0 until politics merges", () => {
    const s = fresh();
    const p = prestige(s, quiet);
    expect(p.influence).toBe(0);
    expect(p.total).toBe(p.wealth + p.standing + p.family + p.influence + p.legacy);
    for (const k of ["wealth", "standing", "family", "influence", "legacy"] as const) {
      expect(p[k]).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(100);
    }
  });

  it("is recorded at each year end", () => {
    let s = fresh();
    const rng = createRng(2);
    for (let i = 0; i < 8; i++) s = endTurn(s, [], rng, quiet);
    expect(s.legacy.history.map((h) => h.year)).toEqual([1815, 1816]);
    expect(s.legacy.history[0]!.total).toBeGreaterThan(0);
  });
});

describe("a full run", () => {
  it("plays 1815 to 1850 choosing the first ambition of every era", () => {
    let s = newGame(quiet, createRng(4));
    const rng = createRng(4);
    while (s.world.year <= 1850 && s.house.status !== "bankrupt") {
      const pick = offeredAmbitions(s, quiet)[0];
      s = endTurn(s, pick ? [{ kind: "choose_ambition", ambition: pick.id }] : [], rng, quiet);
    }
    expect(s.legacy.ambitions.map((r) => r.era)).toEqual([0, 1, 2, 3]);
    expect(s.legacy.ambitions.every((r) => r.status !== "open")).toBe(true);
    expect(s.legacy.history).toHaveLength(36);
  });
});
