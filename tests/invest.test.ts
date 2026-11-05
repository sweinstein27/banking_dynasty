import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecisions } from "../src/sim/decisions";
import { conditionsMet } from "../src/sim/events";
import { checkInvestFamily, headOf, heirTalent } from "../src/sim/family";
import { accountBalance } from "../src/sim/ledger";
import type { GameData } from "../src/sim/tuning";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, quiet } from "./helpers";

const { tuning } = gameData;
const inv = tuning.family.invest;
const CALM = 0.999999;

function decide(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe("educating an heir", () => {
  it("raises one stat of one heir, costs cash and an action, and writes a ledger entry", () => {
    const s0 = fresh();
    const heir = s0.people[1]!;
    const s = decide(s0, { kind: "invest_family", form: "educate", heir: heir.id, stat: "prudence" });
    expect(s.people[1]!.prudence).toBe(heir.prudence + inv.educate.gain);
    expect(s.people[1]!.acumen).toBe(heir.acumen);
    expect(s.house.cash).toBe(s0.house.cash - inv.educate.cost);
    expect(s.actions_this_turn).toBe(1);
    expect(s.ledger.at(-1)).toMatchObject({ account: "cash", category: "family", amount: -inv.educate.cost, note: `Tutors for ${heir.name} (prudence)` });
    expect(accountBalance(s, "cash")).toBe(s.house.cash);
  });

  it("refuses the head, the dead, unknown people, unknown stats, and a stat already at the maximum", () => {
    const s = fresh();
    const educate = (heir: number, stat = "acumen") => checkInvestFamily(s, { kind: "invest_family", form: "educate", heir, stat: stat as "acumen" }, tuning);
    expect(educate(1)).toBe("No living heir #1");
    expect(educate(99)).toBe("No living heir #99");
    expect(educate(2, "charm")).toBe('Unknown stat "charm"');
    s.people[1]!.acumen = tuning.family.max_stat;
    expect(educate(2)).toBe(`${s.people[1]!.name}'s acumen is already ${tuning.family.max_stat}`);
    s.people[2]!.death_year = 1815;
    expect(educate(3)).toBe("No living heir #3");
  });

  it("can make a child a trained successor over the years", () => {
    let s = fresh();
    const id = s.people[1]!.id;
    for (let i = 0; i < 12; i++) {
      const p = s.people.find((x) => x.id === id)!;
      const stat = (["acumen", "prudence", "connections"] as const).find((k) => p[k] < 10)!;
      s = endTurn(s, [{ kind: "invest_family", form: "educate", heir: id, stat }], fixedRng(CALM), quiet);
    }
    const p = s.people.find((x) => x.id === id)!;
    expect(p.acumen + p.prudence + p.connections).toBeGreaterThanOrEqual(tuning.family.succession.trained_total);
  });
});

describe("charity and patronage", () => {
  it("charity buys reputation", () => {
    const s0 = fresh();
    const s = decide(s0, { kind: "invest_family", form: "charity" });
    expect(s.house.reputation).toBe(s0.house.reputation + inv.charity.reputation);
    expect(s.house.cash).toBe(s0.house.cash - inv.charity.cost);
  });

  it("patronage raises the head's Connections and a little reputation", () => {
    const s0 = fresh();
    const s = decide(s0, { kind: "invest_family", form: "patronage" });
    expect(headOf(s)!.connections).toBe(headOf(s0)!.connections + inv.patronage.connections);
    expect(s.house.reputation).toBe(s0.house.reputation + inv.patronage.reputation);
  });

  it("refuses patronage once Connections are at the maximum, and anything without the cash", () => {
    const s = fresh();
    s.people[0]!.connections = tuning.family.max_stat;
    expect(checkInvestFamily(s, { kind: "invest_family", form: "patronage" }, tuning)).toMatch(/already 10/);
    s.house.cash = 100;
    expect(checkInvestFamily(s, { kind: "invest_family", form: "charity" }, tuning)).toMatch(/^Not enough cash above the reserve/);
  });

  it("reputation stops at 100", () => {
    const s = fresh();
    s.house.reputation = 99;
    expect(decide(s, { kind: "invest_family", form: "charity" }).house.reputation).toBe(100);
  });
});

describe("heir events", () => {
  it("heir_talent raises one random stat of one random heir, capped at the maximum", () => {
    const s = fresh();
    const before = structuredClone(s.people);
    // 0.5 of 3 heirs is the second (id 3); 0.5 of 3 stats is prudence.
    heirTalent(s, 2, fixedRng(0.5, 0.5), tuning);
    expect(s.people[2]!.prudence).toBe(Math.min(10, before[2]!.prudence + 2));
    expect(s.people.filter((p, i) => JSON.stringify(p) !== JSON.stringify(before[i]))).toHaveLength(1);
    s.people[2]!.prudence = 9;
    heirTalent(s, 2, fixedRng(0.5, 0.5), tuning);
    expect(s.people[2]!.prudence).toBe(10);
  });

  it("heir_talent with no heirs does nothing and draws no roll", () => {
    const s = fresh();
    s.people = [s.people[0]!];
    let calls = 0;
    heirTalent(s, 2, { next: () => (calls++, 0) }, tuning);
    expect(calls).toBe(0);
  });

  it("has_heirs only lets heir events fire while an heir lives", () => {
    const s = fresh();
    expect(conditionsMet(s, { has_heirs: true }, { year: 1815, quarter: 2 })).toBe(true);
    s.people = [s.people[0]!];
    expect(conditionsMet(s, { has_heirs: true }, { year: 1815, quarter: 2 })).toBe(false);
  });

  it("the talent event names the heir and the stat in the news", () => {
    const data: GameData = { ...quiet, events: gameData.events.filter((e) => e.id === "heir-talent") };
    // Rolls: the mood, the random-event roll, the event pick, then the heir and the stat.
    const s = endTurn(fresh(), [], fixedRng(CALM, 0, 0, 0, 0, CALM), data);
    const heir = s.people[1]!;
    expect(s.news.map((n) => n.title ?? n.text)).toEqual(["Unexpected talent", `${heir.name}'s acumen rises to ${heir.acumen} (was ${heir.acumen - 2}).`]);
  });
});
