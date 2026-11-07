import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { capacityLeft, capacityTotal, checkCapacity, poolFor, poolLeft, poolSize } from "../src/sim/capacity";
import { applyDecision, applyDecisions } from "../src/sim/decisions";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import {
  checkBuild,
  checkHire,
  createCounting,
  resolveCounting,
  skillOf,
  upkeepBill,
  wageBill,
  type StaffRole,
} from "../src/sim/systems/counting";
import { endTurn } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, GOOD, noDefaults, quiet } from "./helpers";

/** The quiet test data with the real counting house: real wages, upkeep and candidates, but no advisor rolls. */
const data = { ...quiet, counting: { ...gameData.counting, advice: { ...gameData.counting.advice, enabled: false } } };
const { tuning } = data;
const roles = data.counting.roles;
/** The starting house's wages (two clerks, a correspondent) and the small room's upkeep. */
const WAGES = 2 * roles.clerk.wage + roles.correspondent.wage;
const ROOM = data.counting.rooms[0]!.upkeep;

/** A fresh test house with the real counting house (candidates drawn from seed 5). */
function house(): GameState {
  const s = fresh();
  s.counting = createCounting(data, createRng(5));
  return s;
}

function ok(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function refusal(s: GameState, d: Decision): string {
  const r = applyDecision(s, d, data);
  return r.ok ? "" : r.reason;
}

const hire = (role: StaffRole, candidate = 0): Decision => ({ kind: "hire", role, candidate });
const lend = (borrower = GOOD): Decision => ({ kind: "lend", borrower, amount: 1000, rate: 0.05 });

describe("the starting counting house", () => {
  it("has the small room and the named staff from the data, working from turn 1", () => {
    const s = house();
    expect(s.counting.room).toBe("small");
    expect(s.counting.staff.map((m) => [m.role, m.name])).toEqual([
      ["clerk", "Matthias Ebert"],
      ["clerk", "Konrad Haas"],
      ["correspondent", "Simon Leclerc"],
    ]);
    expect(s.counting.staff.every((m) => m.start_turn <= s.world.turn)).toBe(true);
    for (const role of Object.keys(roles)) expect(s.counting.candidates[role as keyof typeof roles]).toHaveLength(data.counting.candidates_per_role);
  });

  it("costs two clerks' and a correspondent's wages and the small room's upkeep a quarter", () => {
    const s = house();
    expect(wageBill(s, data)).toBe(WAGES);
    expect(upkeepBill(s, data)).toBe(ROOM);
  });

  it("draws the same candidates from the same seed", () => {
    expect(createCounting(data, createRng(9))).toEqual(createCounting(data, createRng(9)));
  });
});

describe("capacity pools", () => {
  it("maps decision kinds to pools, with the free ones using none", () => {
    expect(poolFor("lend")).toBe("deals");
    expect(poolFor("buy_bond")).toBe("deals");
    expect(poolFor("invest_venture")).toBe("deals");
    expect(poolFor("call_loan")).toBe("deals");
    expect(poolFor("report")).toBe("reports");
    expect(poolFor("consult_analyst")).toBe("opinions");
    for (const k of ["court_house", "arrange_marriage", "invest_family", "borrow"] as const) expect(poolFor(k)).toBe("head");
    for (const k of ["set_reserve", "designate_heir", "answer_letter", "pay_slowly", "suspend", "hire", "dismiss", "build"] as const) expect(poolFor(k)).toBeNull();
    // A kind a later system adds is a deal until it says otherwise.
    expect(poolFor("sell_loan" as Decision["kind"])).toBe("deals");
  });

  it("sizes each pool from the working staff and the head", () => {
    const s = house();
    expect(poolSize(s, "deals", tuning)).toBe(2);
    expect(poolSize(s, "reports", tuning)).toBe(2);
    expect(poolSize(s, "opinions", tuning)).toBe(0);
    expect(poolSize(s, "head", tuning)).toBe(2);
    expect(capacityTotal(s, tuning)).toBe(6);
    expect(capacityLeft(s, tuning)).toBe(6);
  });

  it("draws deals from the clerks first, then the head's time, then refuses", () => {
    let s = house();
    s = ok(s, lend(1), lend(2));
    expect(s.counting.used).toMatchObject({ deals: 2, head: 0 });
    s = ok(s, lend(3), lend(4));
    expect(s.counting.used).toMatchObject({ deals: 2, head: 2 });
    expect(checkCapacity(s, "lend", tuning)).toMatch(/No clerk is free this quarter, nor any of the head's time/);
    expect(checkCapacity(s, "court_house", tuning)).toMatch(/The head has no time left/);
    // Free decisions still go through.
    expect(checkCapacity(s, "set_reserve", tuning)).toBeNull();
    expect(checkCapacity(s, "hire", tuning)).toBeNull();
  });

  it("never lets opinions fall back on the head", () => {
    expect(checkCapacity(house(), "consult_analyst", tuning)).toMatch(/No analyst is free/);
  });

  it("gives a partner two more of the head's time", () => {
    const s = house();
    s.counting.staff.push({ id: 99, role: "partner", name: "P", skill: 5, trait: "sharp", hired_turn: 0, start_turn: 0, leaving: false });
    expect(poolSize(s, "head", tuning)).toBe(tuning.capacity.head + tuning.capacity.partner);
  });

  it("survives the head dying mid-year: the new head has the full time, and with no head there is none", () => {
    const s = house();
    const head = s.people.find((p) => p.is_head)!;
    head.is_head = false;
    head.death_year = s.world.year;
    expect(poolSize(s, "head", tuning)).toBe(0);
    expect(checkCapacity(s, "court_house", tuning)).toMatch(/The head has no time left/);
    s.people.find((p) => p.role === "line" && p.death_year === null)!.is_head = true;
    expect(poolSize(s, "head", tuning)).toBe(tuning.capacity.head);
  });

  it("resets every pool at End Turn", () => {
    let s = ok(house(), lend(1), lend(2), lend(3));
    s = endTurn(s, [], noDefaults, data);
    expect(s.counting.used).toEqual({ deals: 0, reports: 0, opinions: 0, head: 0 });
    expect(poolLeft(s, "deals", tuning)).toBe(2);
  });

  it("refuses everything once the house is bankrupt", () => {
    const s = house();
    s.house.status = "bankrupt";
    expect(checkCapacity(s, "hire", tuning)).toBe("The house is bankrupt");
  });
});

describe("hiring and dismissing", () => {
  it("hires a candidate who starts, and is paid, from next quarter", () => {
    const s0 = house();
    const candidate = s0.counting.candidates.clerk[1]!;
    const s1 = ok(s0, hire("clerk", 1));
    const m = s1.counting.staff.at(-1)!;
    expect(m).toMatchObject({ ...candidate, role: "clerk", hired_turn: 1, start_turn: 2, leaving: false });
    expect(s1.counting.candidates.clerk).toHaveLength(data.counting.candidates_per_role - 1);
    expect(poolSize(s1, "deals", tuning)).toBe(2);
    expect(s1.house.cash).toBe(s0.house.cash);
    expect(s1.actions_this_turn).toBe(0);
    const s2 = endTurn(s1, [], noDefaults, data);
    expect(poolSize(s2, "deals", tuning)).toBe(3);
    expect(wageBill(s2, data)).toBe(WAGES + roles.clerk.wage);
  });

  it("charges no wage for a hire in the quarter they are hired", () => {
    const s0 = house();
    const s1 = endTurn(s0, [hire("clerk")], noDefaults, data);
    const wages = s1.ledger.filter((e) => e.category === "wages").reduce((sum, e) => sum + e.amount, 0);
    expect(wages).toBe(-WAGES);
  });

  it("refuses an unknown candidate, a full room and a second partner", () => {
    let s = house();
    expect(refusal(s, hire("clerk", 7))).toMatch(/No such candidate/);
    // Six desks: three taken, three more fill it.
    s = ok(s, hire("clerk", 0), hire("clerk", 0), hire("teller", 0));
    expect(checkHire(s, { kind: "hire", role: "analyst", candidate: 0 }, data)).toMatch(/No desk free in the counting room \(6 desks\)/);
    // A partner needs no desk, but there is only one.
    s = ok(s, hire("partner", 0));
    expect(refusal(s, hire("partner", 0))).toMatch(/as many of that post as it may \(1\)/);
  });

  it("counts the larger room being built when hiring for next quarter", () => {
    let s = house();
    s.house.cash = 1_000_000;
    s = ok(s, hire("clerk", 0), hire("clerk", 0), hire("clerk", 0));
    expect(refusal(s, hire("teller", 0))).toMatch(/No desk free/);
    s = ok(s, { kind: "build", facility: "counting_room" }, hire("teller", 0));
    expect(s.counting.staff).toHaveLength(7);
  });

  it("limits tellers to the data's maximum", () => {
    let s = house();
    s.counting.room = "large";
    for (let i = 0; i < 5; i++) {
      s.counting.candidates.teller = [s.counting.candidates.clerk[0]!];
      s = ok(s, hire("teller", 0));
    }
    s.counting.candidates.teller = [s.counting.candidates.clerk[0]!];
    expect(refusal(s, hire("teller", 0))).toMatch(/\(5\)/);
  });

  it("dismisses a hire of this quarter at once, and anyone else at the end of the quarter, paid for it", () => {
    let s = ok(house(), hire("clerk", 0));
    const newcomer = s.counting.staff.at(-1)!.id;
    s = ok(s, { kind: "dismiss", staff: newcomer }, { kind: "dismiss", staff: 1 });
    expect(s.counting.staff.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(s.counting.staff[0]!.leaving).toBe(true);
    // Still at work this quarter.
    expect(poolSize(s, "deals", tuning)).toBe(2);
    expect(refusal(s, { kind: "dismiss", staff: 1 })).toMatch(/already leaving/);
    expect(refusal(s, { kind: "dismiss", staff: 42 })).toMatch(/No member of staff #42/);
    const after = endTurn(s, [], noDefaults, data);
    expect(after.ledger.find((e) => e.category === "wages" && e.note.includes("clerk"))!.amount).toBe(-2 * roles.clerk.wage);
    expect(after.counting.staff.map((m) => m.id)).toEqual([2, 3]);
    expect(poolSize(after, "deals", tuning)).toBe(1);
  });

  it("raises skill one point per quarters_per_point served, up to the cap", () => {
    const m = { skill: 4, start_turn: 1 };
    const q = data.counting.skill.quarters_per_point;
    expect(skillOf(m, 1, data)).toBe(4);
    expect(skillOf(m, 1 + q - 1, data)).toBe(4);
    expect(skillOf(m, 1 + q, data)).toBe(5);
    expect(skillOf(m, 1000, data)).toBe(data.counting.skill.cap);
  });
});

describe("building", () => {
  it("pays now, writes the ledger, and works from next quarter", () => {
    const s0 = house();
    const s1 = ok(s0, { kind: "build", facility: "strongroom" });
    const cost = data.counting.facilities.strongroom.build;
    expect(s1.house.cash).toBe(s0.house.cash - cost);
    expect(s1.ledger.at(-1)).toMatchObject({ account: "cash", category: "building", amount: -cost, note: "Building a strongroom" });
    expect(upkeepBill(s1, data)).toBe(ROOM);
    const s2 = endTurn(s1, [], noDefaults, data);
    expect(upkeepBill(s2, data)).toBe(ROOM + data.counting.facilities.strongroom.upkeep);
    expect(accountBalance(s2, "cash")).toBe(s2.house.cash);
  });

  it("refuses a second of the same, building beyond the largest room, and spending into the reserve", () => {
    let s = house();
    s.house.cash = 1_000_000;
    s = ok(s, { kind: "build", facility: "archive" });
    expect(checkBuild(s, { kind: "build", facility: "archive" }, data)).toBe("The house already has an archive");
    s = ok(s, { kind: "build", facility: "counting_room" });
    expect(checkBuild(s, { kind: "build", facility: "counting_room" }, data)).toMatch(/already being built/);
    s = endTurn(s, [], noDefaults, data);
    expect(s.counting.room).toBe("medium");
    s = ok(s, { kind: "build", facility: "counting_room" });
    s = endTurn(s, [], noDefaults, data);
    expect(s.counting.room).toBe("large");
    expect(checkBuild(s, { kind: "build", facility: "counting_room" }, data)).toMatch(/as large as it can be/);
    const poor = house();
    poor.house.reserve = poor.house.cash - 100;
    expect(checkBuild(poor, { kind: "build", facility: "warehouse" }, data)).toMatch(/Not enough cash above the reserve/);
  });
});

describe("wages and upkeep at End Turn", () => {
  it("writes one wage line per role and one upkeep line per room or facility", () => {
    const s0 = house();
    s0.counting.facilities.push({ id: "warehouse", ready_turn: 0 });
    const s1 = endTurn(s0, [], noDefaults, data);
    const lines = s1.ledger.filter((e) => e.category === "wages" || e.category === "upkeep").map((e) => [e.note, e.amount]);
    expect(lines).toEqual([
      ["Wages: 2 clerks", -2 * roles.clerk.wage],
      ["Wages: 1 correspondent", -roles.correspondent.wage],
      ["Upkeep: small counting room", -ROOM],
      ["Upkeep: warehouse", -data.counting.facilities.warehouse.upkeep],
    ]);
    expect(s1.house.cash).toBe(s0.house.cash - WAGES - ROOM - data.counting.facilities.warehouse.upkeep);
  });

  it("pays wages out of the reserve if it must", () => {
    const s = house();
    s.house.reserve = s.house.cash;
    resolveCounting(s, fixedRng(0.5), data);
    expect(s.house.status).toBe("solvent");
    expect(s.house.cash).toBe(100_000 - WAGES - ROOM);
  });

  it("with no cash and wages due, sells assets at a discount to pay them", () => {
    let s = ok(house(), { kind: "buy_bond", state: "bavaria", face_value: 10000 });
    s.house.cash = 0;
    resolveCounting(s, fixedRng(0.5), data);
    expect(s.house.status).toBe("solvent");
    expect(s.ledger.some((e) => e.category === "forced_sale" && e.note.includes("to pay wages and upkeep"))).toBe(true);
    expect(s.house.cash).toBeGreaterThanOrEqual(0);
    expect(s.ledger.filter((e) => e.category === "wages" || e.category === "upkeep").reduce((sum, e) => sum + e.amount, 0)).toBe(-WAGES - ROOM);
  });

  it("bankrupts a house that cannot pay even its upkeep", () => {
    const s = house();
    s.counting.staff = [];
    s.house.cash = ROOM - 1;
    resolveCounting(s, fixedRng(0.5), data);
    expect(s.house.status).toBe("bankrupt");
  });

  it("bankrupts a house with no cash and no assets when wages fall due, and the run ends", () => {
    const s0 = house();
    s0.house.cash = 0;
    s0.house.deposits = 0;
    const s1 = endTurn(s0, [], noDefaults, data);
    expect(s1.house.status).toBe("bankrupt");
    expect(() => endTurn(s1, [], noDefaults, data)).toThrow(/bankrupt/);
  });

  it("charges nothing to a bankrupt house", () => {
    const s = house();
    s.house.status = "bankrupt";
    const before = s.ledger.length;
    resolveCounting(s, fixedRng(0.5), data);
    expect(s.ledger).toHaveLength(before);
  });

  it("keeps every balance on the ledger over a run of hiring, building and dismissing", () => {
    const rng = createRng(11);
    let s = house();
    const plan: Decision[][] = [[hire("clerk", 0), { kind: "build", facility: "strongroom" }], [{ kind: "dismiss", staff: 2 }], [hire("teller", 0)], [{ kind: "build", facility: "counting_room" }]];
    for (let t = 0; t < 12; t++) s = endTurn(s, plan[t] ?? [], rng, data);
    for (const account of ["cash", "deposits"] as const) expect(accountBalance(s, account)).toBe(account === "cash" ? s.house.cash : s.house.deposits);
  });
});
