import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { chronicle } from "../src/sim/chronicle";
import { applyDecisions } from "../src/sim/decisions";
import { conditionsMet } from "../src/sim/events";
import { heirsOf, resolveFamily } from "../src/sim/family";
import { createHouses, resolveHouses } from "../src/sim/houses";
import { accountBalance } from "../src/sim/ledger";
import { allies, dowryIn, marriageable } from "../src/sim/marriages";
import { parseSave, toSave } from "../src/sim/save";
import { endTurn } from "../src/sim/turn";
import type { ArrangeMarriageDecision, GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const m = gameData.tuning.family.marriage;
const FRIEDRICH = 2;
const AMALIE = 3;
const CARL = 4;
const CALM = 0.999999;

/** A test game in 1825 (Friedrich 22, Amalie 19, Carl 15) with the real houses. */
function in1825(): GameState {
  const s = fresh();
  s.world.year = 1825;
  s.houses = createHouses(gameData);
  return s;
}

const house = (s: GameState, id: string) => s.houses.find((h) => h.id === id)!;
const marry = (member: number, withHouse: string, form: "in" | "out" = "in"): ArrangeMarriageDecision => ({ kind: "arrange_marriage", member, with: withHouse, form });

function result(s: GameState, d: ArrangeMarriageDecision) {
  return applyDecisions(s, [d], gameData);
}
function ok(s: GameState, d: ArrangeMarriageDecision): GameState {
  const r = result(s, d);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
function refused(s: GameState, d: ArrangeMarriageDecision): string {
  const r = result(s, d);
  return r.ok ? "" : r.reason;
}

describe("who may marry", () => {
  it("members of the line of age with no living spouse", () => {
    const s = in1825();
    expect(marriageable(s, gameData).map((p) => p.id)).toEqual([FRIEDRICH, AMALIE]);
    expect(refused(s, marry(CARL, "merchant"))).toBe(`Carl Adler is too young to marry (aged 15, needs ${m.min_age})`);
    expect(refused(s, marry(1, "merchant"))).toBe("Johann Adler is already married");
    expect(refused(s, marry(99, "merchant"))).toBe("No living member of the line #99");
  });

  it("a widowed head may marry again, but never out of the house", () => {
    const s = in1825();
    s.people.find((p) => p.role === "spouse")!.death_year = 1824;
    expect(marriageable(s, gameData).map((p) => p.id)).toContain(1);
    house(s, "winter").opinion = 50;
    expect(refused(s, marry(1, "winter", "out"))).toBe("The head of the house cannot marry out of it");
  });
});

describe("marrying in", () => {
  it("needs the house's good opinion and a good enough name", () => {
    const s = in1825();
    expect(refused(s, marry(FRIEDRICH, "albrecht"))).toBe(`Bankhaus Albrecht will not hear of a match (opinion 0, needs ${m.in.min_opinion})`);
    house(s, "albrecht").opinion = 30;
    expect(refused(s, marry(FRIEDRICH, "albrecht"))).toBe(`Bankhaus Albrecht thinks your house beneath it (reputation 50, needs ${70 - m.in.reputation_gap})`);
  });

  it("brings a spouse with the house's trait, a dowry and an alliance, for one action", () => {
    const s0 = in1825();
    house(s0, "albrecht").opinion = 30;
    s0.house.reputation = 60;
    const s = ok(s0, marry(FRIEDRICH, "albrecht"));
    const friedrich = s.people.find((p) => p.id === FRIEDRICH)!;
    const wife = s.people.at(-1)!;
    expect(wife).toMatchObject({
      name: `${gameData.family.spouse_names.f[0]} Adler`, gender: "f", role: "spouse", spouse: FRIEDRICH, origin: "albrecht", born: "Albrecht",
      birth_year: 1805, acumen: 4, prudence: 4, connections: 4, traits: ["prudent"],
    });
    expect(friedrich.spouse).toBe(wife.id);
    const dowry = dowryIn(house(s0, "albrecht"), gameData);
    expect(dowry).toBe(5000);
    expect(s.house.cash).toBe(s0.house.cash + dowry);
    expect(s.ledger.at(-1)).toMatchObject({ account: "cash", category: "dowry", amount: dowry });
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
    expect(house(s, "albrecht")).toMatchObject({ opinion: 30 + m.in.opinion, baseline: m.in.baseline });
    expect(allies(s)).toEqual(new Set(["albrecht"]));
    expect(s.actions_this_turn).toBe(1);
    expect(heirsOf(s).map((p) => p.id)).toEqual([FRIEDRICH, AMALIE, CARL]);
  });

  it("a merchant family always agrees, for a small cost, and brings no alliance", () => {
    const s0 = in1825();
    const s = ok(s0, marry(AMALIE, "merchant"));
    const husband = s.people.at(-1)!;
    expect(husband).toMatchObject({ gender: "m", origin: "merchant", born: null, acumen: m.merchant.stat, traits: [], birth_year: 1804 });
    expect(s.house.cash).toBe(s0.house.cash - m.merchant.cost);
    expect(allies(s).size).toBe(0);
    expect(refused(s0, marry(AMALIE, "merchant", "out"))).toBe("A merchant's family marries into this house, not the other way");
  });

  it("the married couple has children at year end", () => {
    const s = ok(in1825(), marry(AMALIE, "merchant"));
    s.world.quarter = 4;
    const before = s.people.length;
    // Rolls: the head's death roll (Johann is 60: survives), then the couple's birth roll (0), gender, stats.
    resolveFamily(s, fixedRng(CALM, 0, 0.5, 0.5, 0.5, 0.5), quiet);
    expect(s.people.length).toBe(before + 1);
    expect(s.people.at(-1)!.parents).toEqual([AMALIE, before]);
  });
});

describe("marrying out", () => {
  it("costs a dowry and the heir, and ties the houses closer", () => {
    const s0 = in1825();
    s0.house.designated_heir = AMALIE;
    const s = ok(s0, marry(AMALIE, "winter", "out"));
    expect(s.people.find((p) => p.id === AMALIE)).toMatchObject({ role: "left", origin: "winter", spouse: null });
    expect(heirsOf(s).map((p) => p.id)).toEqual([FRIEDRICH, CARL]);
    expect(s.house.designated_heir).toBeNull();
    expect(s.house.cash).toBe(s0.house.cash - m.out.dowry);
    expect(house(s, "winter")).toMatchObject({ opinion: 10 + m.out.opinion, baseline: 10 + m.out.baseline });
    expect(allies(s)).toEqual(new Set(["winter"]));
  });

  it("needs only a neutral house, but not a failed one, and the cash", () => {
    const s = in1825();
    expect(refused(s, marry(AMALIE, "kessler", "out"))).toBe(`Bankhaus Kessler will not hear of a match (opinion -30, needs ${m.out.min_opinion})`);
    house(s, "winter").failed_turn = 1;
    expect(refused(s, marry(AMALIE, "winter", "out"))).toBe("Gebrüder Winter has failed");
    s.house.reserve = s.house.cash;
    expect(refused(s, marry(AMALIE, "albrecht", "out"))).toMatch(/^Not enough cash above the reserve/);
  });
});

describe("alliances", () => {
  it("an ally's failure costs reputation", () => {
    const s = ok(in1825(), marry(AMALIE, "rautenberg", "out"));
    s.world.sentiment = "panic";
    const rep = s.house.reputation;
    // Rolls for each house: noise, then the failure roll; only Rautenberg (last) fails. Albrecht's head is 67: a death roll.
    const rolls = [0.5, CALM, 0.5, CALM, CALM, 0.5, CALM, 0.5, CALM, 0.5, 0];
    resolveHouses(s, fixedRng(...rolls), gameData);
    expect(house(s, "rautenberg").failed_turn).not.toBeNull();
    expect(s.house.reputation).toBe(rep - m.ally_failure_reputation);
  });

  it("Kessler's rumours never come once Kessler is an ally", () => {
    const rumours = gameData.events.find((e) => e.id === "rival-rumours")!;
    const s = in1825();
    const date = { year: 1825, quarter: 2 as const };
    expect(conditionsMet(s, rumours.conditions, date)).toBe(true);
    s.marriages.push({ turn: 1, member: AMALIE, spouse: null, house: "kessler", form: "out", dowry: -2000 });
    expect(conditionsMet(s, rumours.conditions, date)).toBe(false);
  });
});

describe("news and saves", () => {
  it("the Gazette reports each kind of match and a spouse's death", () => {
    const s0 = in1825();
    house(s0, "stellmann").opinion = 40;
    s0.house.reputation = 60;
    const s1 = endTurn(s0, [marry(FRIEDRICH, "stellmann"), marry(AMALIE, "winter", "out")], fixedRng(CALM), quiet);
    const family = s1.news.filter((n) => n.kind === "family").map((n) => n.text);
    expect(family).toContain(`Friedrich Adler marries ${gameData.family.spouse_names.f[0]} Stellmann, of Haus Stellmann, who brings a dowry of 2,000 fl. The two houses are allied.`.replace(" ", " "));
    expect(family).toContain("Amalie Adler marries into Gebrüder Winter and leaves the house of Adler, with a dowry of 2,000 fl.");
    const s2 = { ...s1, people: s1.people.map((p) => ({ ...p })) };
    const wife = s2.people.find((p) => p.role === "spouse" && p.spouse === 1)!;
    wife.birth_year = 1755;
    s2.houses = [];
    // Rolls: the mood, the event roll, Johann's death roll (survives), then his wife's (0: dies).
    const s3 = endTurn(s2, [], fixedRng(CALM, CALM, CALM, 0, CALM), quiet);
    expect(s3.news.some((n) => n.text === `Margarethe Adler, wife of Johann Adler, has died, aged ${s2.world.year - 1755}.`)).toBe(true);
  });

  it("saves keep the marriages and refuse a file without them", () => {
    const s = ok(in1825(), marry(AMALIE, "merchant"));
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.marriages).toEqual(s.marriages);
    const old = { ...s } as Partial<GameState>;
    delete old.marriages;
    const bad = parseSave(toSave(old as GameState, 1, 1, []), gameData);
    expect(bad.ok ? "" : bad.reason).toBe('Save file state is missing "marriages"');
  });
});

describe("the chronicle", () => {
  it("records each marriage", () => {
    const s0 = in1825();
    house(s0, "stellmann").opinion = 40;
    s0.house.reputation = 60;
    const s = endTurn(s0, [marry(FRIEDRICH, "stellmann"), marry(AMALIE, "winter", "out")], fixedRng(CALM), quiet);
    const text = chronicle(s, gameData).join(" ");
    expect(text).toContain(`In 1815 Friedrich Adler married ${gameData.family.spouse_names.f[0]} Stellmann, of Haus Stellmann, and the houses were allied.`);
    expect(text).toContain("In 1815 Amalie Adler married into Gebrüder Winter.");
  });
});
