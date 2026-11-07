import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { bondDefaultChance, bondPrice, stateRisk } from "../src/sim/bonds";
import { applyDecisions } from "../src/sim/decisions";
import { checkEventData, conditionsMet, nextQuarter } from "../src/sim/events";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { parseSave, toSave } from "../src/sim/save";
import type { GameData, GameEvent } from "../src/sim/tuning";
import { defaultChance } from "../src/sim/loans";
import { endTurn, loanBook } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, GOOD, GOOD_2, quiet } from "./helpers";

const { tuning } = gameData;
const withEvents = (...events: GameEvent[]): GameData => ({ ...quiet, events });

function historical(id: string, year: number, quarter: 1 | 2 | 3 | 4, effects: GameEvent["effects"] = [{ kind: "reputation", delta: 5 }], conditions = {}): GameEvent {
  return { id, title: `Title ${id}`, text: `Text ${id}.`, historical: true, year, quarter, conditions, effects };
}

function random(id: string, weight: number, effects: GameEvent["effects"] = [{ kind: "reputation", delta: -5 }], conditions = {}): GameEvent {
  return { id, title: `Title ${id}`, text: `Text ${id}.`, historical: false, weight, conditions, effects };
}

function decide(s: GameState, ...ds: Decision[]): GameState {
  const r = applyDecisions(s, ds, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

/** Rolls for a turn with no holdings: mood (stay calm), then the random-event roll. */
const CALM = 0.999999;
const noRandom = fixedRng(CALM, CALM);
const randomFires = (pick: number) => fixedRng(CALM, 0, pick, CALM);

describe("nextQuarter", () => {
  it("advances a quarter and rolls Q4 into the next year", () => {
    expect(nextQuarter({ year: 1825, quarter: 3 })).toEqual({ year: 1825, quarter: 4 });
    expect(nextQuarter({ year: 1825, quarter: 4 })).toEqual({ year: 1826, quarter: 1 });
  });
});

describe("historical events", () => {
  const data = withEvents(historical("peace", 1815, 2));

  it("fire at the end of the turn before their quarter, once, with a headline in the news", () => {
    const s1 = endTurn(fresh(), [], noRandom, data);
    expect(s1.fired_events).toEqual([{ id: "peace", turn: 1 }]);
    expect(s1.house.reputation).toBe(55);
    expect(s1.news[0]).toEqual({ turn: 1, kind: "event", title: "Title peace", text: "Text peace." });
    const s2 = endTurn(s1, [], noRandom, data);
    expect(s2.fired_events).toHaveLength(1);
    expect(s2.house.reputation).toBe(55);
  });

  it("do not fire before or after their quarter", () => {
    let s = fresh();
    const later = withEvents(historical("later", 1816, 1));
    for (let i = 0; i < 2; i++) s = endTurn(s, [], noRandom, later);
    expect(s.fired_events).toEqual([]);
    const late = endTurn(fresh(), [], noRandom, withEvents(historical("past", 1815, 1)));
    expect(late.fired_events).toEqual([]);
  });

  it("never fire if their conditions fail on their date", () => {
    const d = withEvents(historical("needs-panic", 1815, 2, undefined, { sentiment: ["panic"] }));
    let s = endTurn(fresh(), [], noRandom, d);
    expect(s.fired_events).toEqual([]);
    s.world.sentiment = "panic";
    s = endTurn(s, [], fixedRng(0.999999, CALM), d);
    expect(s.fired_events).toEqual([]);
  });
});

describe("random events", () => {
  it("do not fire when the roll is at or above the chance", () => {
    const d = withEvents(random("a", 1));
    const s = endTurn(fresh(), [], fixedRng(CALM, tuning.events.random_chance), d);
    expect(s.fired_events).toEqual([]);
  });

  it("pick by weight among the eligible", () => {
    const d = withEvents(random("light", 1), random("heavy", 3));
    // Total weight 4: a pick below 0.25 lands on "light", above on "heavy".
    expect(endTurn(fresh(), [], randomFires(0.2), d).fired_events[0]!.id).toBe("light");
    expect(endTurn(fresh(), [], randomFires(0.3), d).fired_events[0]!.id).toBe("heavy");
  });

  it("skip events whose conditions fail, drawing no pick roll when none is eligible", () => {
    const d = withEvents(random("needs-loans", 1, undefined, { has_active_loans: true }));
    let calls = 0;
    const s = endTurn(fresh(), [], { next: () => (calls++, calls === 2 ? 0 : CALM) }, d);
    expect(s.fired_events).toEqual([]);
    expect(calls).toBe(2);
  });

  it("wait out their cooldown before firing again", () => {
    const d = withEvents(random("rumour", 1, [{ kind: "reputation", delta: -1 }]));
    let s = endTurn(fresh(), [], randomFires(0), d);
    for (let i = 1; i < tuning.events.cooldown_quarters; i++) s = endTurn(s, [], randomFires(0), d);
    expect(s.fired_events).toHaveLength(1);
    s = endTurn(s, [], randomFires(0), d);
    expect(s.fired_events.map((f) => f.turn)).toEqual([1, 1 + tuning.events.cooldown_quarters]);
  });

  it("respect an event's own cooldown", () => {
    const d = withEvents({ ...random("often", 1), cooldown_quarters: 2 });
    let s = fresh();
    for (let i = 0; i < 4; i++) s = endTurn(s, [], randomFires(0), d);
    expect(s.fired_events.map((f) => f.turn)).toEqual([1, 3]);
  });
});

describe("event effects", () => {
  const fire = (effects: GameEvent["effects"], s = fresh(), rng = noRandom) =>
    endTurn(s, [], rng, withEvents(historical("e", s.world.quarter === 4 ? s.world.year + 1 : s.world.year, (s.world.quarter % 4) + 1 as 1 | 2 | 3 | 4, effects)));

  it("set_sentiment overrides the mood roll, and bonds are marked to the new mood", () => {
    const s0 = decide(fresh(), { kind: "buy_bond", state: "france", face_value: 10000 });
    // Rolls: France's default roll, the mood, the random-event roll.
    const s = fire([{ kind: "set_sentiment", sentiment: "panic" }], s0, fixedRng(CALM, CALM, CALM));
    expect(s.world.sentiment).toBe("panic");
    expect(s.bonds[0]!.price).toBe(bondPrice(0.4, "panic", tuning));
    expect(s.news.map((n) => n.kind)).toEqual(["event", "mood"]);
  });

  it("reputation moves within 0 to 100 and is reported", () => {
    const s = fire([{ kind: "reputation", delta: -12 }]);
    expect(s.house.reputation).toBe(38);
    expect(s.news.at(-1)).toEqual({ turn: 1, kind: "reputation", text: "The house's reputation falls to 38 (was 50)." });
    expect(fire([{ kind: "reputation", delta: 80 }]).house.reputation).toBe(100);
    expect(fire([{ kind: "reputation", delta: -80 }]).house.reputation).toBe(0);
  });

  it("cash effects pay or take a fixed amount or a share, with a ledger entry", () => {
    const gain = fire([{ kind: "cash", amount: 2500 }]);
    expect(gain.house.cash).toBe(102500);
    expect(gain.ledger.at(-1)).toMatchObject({ account: "cash", category: "event", amount: 2500, note: "Event: Title e" });
    expect(fire([{ kind: "cash", share: -0.05 }]).house.cash).toBe(95000);
    expect(accountBalance(gain, "cash")).toBe(gain.house.cash);
  });

  it("a cash loss takes no more than the cash there is", () => {
    const s0 = fresh();
    s0.house.cash = 0;
    s0.house.deposits = 0;
    s0.ledger = [];
    const s = fire([{ kind: "cash", amount: -5000 }], s0);
    expect(s.house.cash).toBe(0);
    expect(s.ledger.filter((e) => e.category === "event")).toEqual([]);
  });

  it("loan_default defaults one active loan picked at random, and the news names the borrower", () => {
    const s0 = decide(fresh(),
      { kind: "lend", amount: 10000, rate: 0.06, borrower: GOOD },
      { kind: "lend", amount: 20000, rate: 0.06, borrower: GOOD_2 });
    // Rolls: two loan defaults (no), the mood, the random-event roll, then the pick (0.6 of 2 loans: the second).
    const s = fire([{ kind: "loan_default" }], s0, fixedRng(CALM, CALM, CALM, CALM, 0.6));
    expect(s.loans.map((l) => l.status)).toEqual(["active", "defaulted"]);
    expect(loanBook(s)).toBe(10000);
    expect(accountBalance(s, "loans")).toBe(loanBook(s));
    expect(s.news.find((n) => n.kind === "loan_default")!.text).toContain(s.loans[1]!.borrower_name);
  });

  it("loan_default with no active loans does nothing and draws no roll", () => {
    let calls = 0;
    const s = fire([{ kind: "loan_default" }], fresh(), { next: () => (calls++, CALM) });
    expect(calls).toBe(2);
    expect(s.loans).toEqual([]);
  });

  it("state_risk shifts a state's risk, its bond prices and its default chance", () => {
    const s0 = decide(fresh(), { kind: "buy_bond", state: "france", face_value: 10000 });
    s0.world.sentiment = "uneasy";
    const france = gameData.states.find((st) => st.id === "france")!;
    const s = fire([{ kind: "state_risk", state: "france", delta: 0.3 }], s0, fixedRng(CALM, CALM, CALM));
    expect(s.risk_shift).toEqual({ france: 0.3 });
    expect(stateRisk(s, france)).toBe(0.7);
    expect(s.bonds[0]!.risk).toBe(0.7);
    expect(s.bonds[0]!.price).toBe(bondPrice(0.7, "uneasy", tuning));
    expect(bondDefaultChance(stateRisk(s, france), "uneasy", tuning)).toBeGreaterThan(bondDefaultChance(france.risk, "uneasy", tuning));
    expect(accountBalance(s, "bonds")).toBe(s.bonds.reduce((sum, b) => sum + Math.round(b.face_value * b.price), 0));
  });

  it("trade_risk scales every loan's default chance from then on", () => {
    const s = fire([{ kind: "trade_risk", factor: 0.8 }]);
    expect(s.trade_risk).toBe(0.8);
    const before = fresh();
    before.trade_risk = 0.8;
    expect(fire([{ kind: "trade_risk", factor: 0.5 }], before).trade_risk).toBe(0.4);
    expect(defaultChance(0.5, "calm", tuning, s.trade_risk)).toBeCloseTo(defaultChance(0.5, "calm", tuning, 1) * 0.8);
  });

  it("state risk stays within 0 to 1", () => {
    const s = fresh();
    const naples = gameData.states.find((st) => st.id === "naples")!;
    s.risk_shift = { naples: 2 };
    expect(stateRisk(s, naples)).toBe(1);
    s.risk_shift = { naples: -2 };
    expect(stateRisk(s, naples)).toBe(0);
  });
});

describe("conditionsMet", () => {
  const s = fresh();
  const date = { year: 1830, quarter: 3 as const };

  it("checks years against the quarter the event describes", () => {
    expect(conditionsMet(s, { min_year: 1830, max_year: 1830 }, date)).toBe(true);
    expect(conditionsMet(s, { min_year: 1831 }, date)).toBe(false);
    expect(conditionsMet(s, { max_year: 1829 }, date)).toBe(false);
  });

  it("checks mood, reputation, loans and bonds held", () => {
    expect(conditionsMet(s, { sentiment: ["uneasy", "panic"] }, date)).toBe(false);
    expect(conditionsMet(s, { min_reputation: 51 }, date)).toBe(false);
    expect(conditionsMet(s, { max_reputation: 50 }, date)).toBe(true);
    expect(conditionsMet(s, { has_active_loans: false }, date)).toBe(true);
    expect(conditionsMet(s, { holds_bonds_of: "france" }, date)).toBe(false);
    const withBonds = decide(s, { kind: "buy_bond", state: "france", face_value: 1000 });
    expect(conditionsMet(withBonds, { holds_bonds_of: "france" }, date)).toBe(true);
  });
});

describe("checkEventData", () => {
  it("finds no problems in data/events.json", () => {
    expect(checkEventData(gameData)).toEqual([]);
  });

  it("reports malformed events", () => {
    const bad = withEvents(
      { ...historical("h", 1830, 3), weight: 2 },
      { ...historical("h", 1830, 3) },
      { ...random("r", 0), text: "A rumour — spreads." },
      random("s", 1, [{ kind: "state_risk", state: "atlantis", delta: 0.1 }, { kind: "cash" }]),
    );
    expect(checkEventData(bad)).toEqual([
      "h: historical events take no weight",
      "h: duplicate id",
      "r: uses a dash; the writing style forbids em dashes",
      "r: random events need a weight above zero",
      's: unknown state "atlantis"',
      "s: cash effects need exactly one of amount or share",
    ]);
  });
});

describe("saves with events", () => {
  it("keep fired events and risk shifts", () => {
    const s = endTurn(fresh(), [], noRandom, withEvents(historical("peace", 1815, 2, [{ kind: "state_risk", state: "france", delta: 0.1 }])));
    const r = parseSave(toSave(s, 1, 1, []), gameData);
    expect(r.ok && r.save.state.fired_events).toEqual([{ id: "peace", turn: 1 }]);
    expect(r.ok && r.save.state.risk_shift).toEqual({ france: 0.1 });
  });

  it("refuse a state without risk_shift", () => {
    const raw = JSON.parse(toSave(fresh(), 1, 1, []));
    delete raw.state.risk_shift;
    const r = parseSave(JSON.stringify(raw), gameData);
    expect(r.ok ? null : r.reason).toMatch(/risk_shift/);
  });
});

describe("data/events.json in a full run", () => {
  it("fires every historical event once, in its quarter, and the books still reconcile", () => {
    let s = fresh();
    const rng = { next: (() => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })() };
    // A2: the quiet counting house, so an idle house's wages do not bankrupt it.
    while (s.world.year <= tuning.end.year) s = endTurn(s, [], rng, { ...gameData, counting: quiet.counting });
    for (const ev of gameData.events.filter((e) => e.historical)) {
      const fired = s.fired_events.filter((f) => f.id === ev.id);
      expect(fired, ev.id).toHaveLength(1);
      // Fired at the end of the turn before its quarter: turn 1 is 1815 Q1.
      const turnOfQuarter = (ev.year! - 1815) * 4 + ev.quarter!;
      expect(fired[0]!.turn, ev.id).toBe(turnOfQuarter - 1);
    }
    expect(s.fired_events.some((f) => !gameData.events.find((e) => e.id === f.id)!.historical)).toBe(true);
    for (const account of ["cash", "deposits"] as const) expect(accountBalance(s, account)).toBe(account === "cash" ? s.house.cash : s.house.deposits);
  });

  it("puts the 1825 crisis in the news as uneasy, then panic in 1826 Q1", () => {
    let s = fresh();
    while (!(s.world.year === 1826 && s.world.quarter === 1)) s = endTurn(s, [], fixedRng(0.999999), gameData);
    expect(s.world.sentiment).toBe("panic");
    expect(s.news.filter((n) => n.kind === "event").map((n) => n.title)).toEqual(expect.arrayContaining(["Banks fail in London", "Panic reaches the continent"]));
  });
});
