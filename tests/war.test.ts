import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { closeChance } from "../src/sim/europe/branches";
import { cityState, nextStatus } from "../src/sim/europe/world";
import { succeed } from "../src/sim/family";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { endTurn, netWorth } from "../src/sim/turn";
import type { GameData } from "../src/sim/tuning";
import type { GameState } from "../src/sim/types";
import { curveAt, grainDearness, rollHome, rollPressure, stageAt, syncEffects, wantedRisk } from "../src/sim/war/campaigns";
import { failChance, openOffers, raiseFromWar, serviceWarLoans, warLoanGate } from "../src/sim/war/loans";
import { resolveWar, unrestFactor, warBondDiscount, warBook, warContractFactor } from "../src/sim/systems/war";
import { fixedRng, quiet } from "./helpers";

/** Quiet data with the real campaigns and Frankfurt's dated troubles, but pressure that moves nothing. */
const W: GameData = { ...quiet, war: { ...quiet.war, campaigns: gameData.war.campaigns, home: gameData.war.home } };
const war = gameData.war;
const DASH = /[—–]/;

function game(data = W): GameState {
  const s = newGame(data, createRng(1));
  s.house.reputation = 70;
  return s;
}

/** Moves the calendar to `year`/`quarter`, with every campaign in its stage for that quarter. */
function at(s: GameState, year: number, quarter: 1 | 2 | 3 | 4, data = W): GameState {
  s.world.year = year;
  s.world.quarter = quarter;
  for (const c of data.war.campaigns) s.war.campaigns[c.id]!.stage = stageAt(c, { year, quarter });
  return s;
}

function lend(s: GameState, offer: string, amount: number, data = W): GameState {
  const r = applyDecision(s, { kind: "subscribe_war_loan", offer, amount }, data);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

const booksMatch = (s: GameState) => expect(accountBalance(s, "war_loans")).toBe(warBook(s));
/** A roll stream that is always `u`. */
const always = (u: number) => ({ next: () => u });

describe("war data", () => {
  it("names only known states, borrowers and cities, in date order, with no dashes", () => {
    const states = new Set(gameData.states.map((s) => s.id));
    const borrowers = new Set([...states, ...war.borrowers.map((b) => b.id)]);
    const ids = new Set<string>();
    const offers = new Set<string>();
    for (const c of war.campaigns) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      for (const s of c.states) expect(states.has(s), `${c.id} ${s}`).toBe(true);
      const dates = c.timeline.map((t) => t.year * 4 + t.quarter);
      expect(dates, c.id).toEqual([...dates].sort((a, b) => a - b));
      for (const t of c.timeline) expect(DASH.test(t.title + t.text), t.title).toBe(false);
      for (const o of c.offers) {
        expect(offers.has(o.id), o.id).toBe(false);
        offers.add(o.id);
        expect(borrowers.has(o.borrower), o.id).toBe(true);
        expect(o.phases.length).toBeGreaterThan(0);
        expect(DASH.test(o.text)).toBe(false);
      }
    }
    for (const h of war.home) expect(DASH.test(h.title + h.text), h.id).toBe(false);
    for (const h of gameData.europe.history) expect(DASH.test(h.title + h.text), h.id).toBe(false);
    expect(new Set(gameData.europe.history.map((h) => h.id)).size).toBe(gameData.europe.history.length);
    for (const t of [...war.texts.warn, war.texts.home_unrest, war.texts.home_peace]) expect(DASH.test(t.title + t.text)).toBe(false);
    // Events this milestone adds use the war- prefix.
    expect(gameData.events.some((e) => e.id === "war-september-1848")).toBe(true);
  });
});

describe("campaigns", () => {
  const hundred = war.campaigns.find((c) => c.id === "hundred-days-1815")!;

  it("stand in the stage of their last dated turn", () => {
    expect(stageAt(hundred, { year: 1814, quarter: 4 })).toBe("before");
    expect(stageAt(hundred, { year: 1815, quarter: 1 })).toBe("mobilizing");
    expect(stageAt(hundred, { year: 1815, quarter: 2 })).toBe("fighting");
    expect(stageAt(hundred, { year: 1815, quarter: 3 })).toBe("settling");
    expect(stageAt(hundred, { year: 1815, quarter: 4 })).toBe("over");
    expect(stageAt(hundred, { year: 1840, quarter: 1 })).toBe("over");
  });

  it("start the game with the Hundred Days under way and its loans open", () => {
    const s = game();
    expect(s.war.campaigns["hundred-days-1815"]!.stage).toBe("mobilizing");
    expect(s.war.campaigns["austria-1848"]!.stage).toBe("before");
    expect(openOffers(s, W).map((o) => o.offer.id)).toEqual(["prussia-1815", "austria-1815"]);
  });

  it("move to fighting with news, risk on every state at war, trade risk and a fortune roll each", () => {
    const s = game();
    // Rolls: fortunes for prussia, austria, bavaria, france (bad below 0.4), then Frankfurt.
    resolveWar(s, createRng(0), W);
    expect(s.war.campaigns["hundred-days-1815"]!.stage).toBe("fighting");
    expect(s.news.some((n) => n.title === "The armies march")).toBe(true);
    expect(s.news.some((n) => n.title === "News of the Hundred Days")).toBe(true);
    for (const st of hundred.states) {
      const f = s.war.campaigns["hundred-days-1815"]!.fortune[st]!;
      expect(Math.abs(f)).toBe(1);
      expect(s.risk_shift[st]).toBeCloseTo(Math.max(0, 0.08 + f * war.fortune.swing), 6);
    }
    expect(s.trade_risk).toBeCloseTo(1.1, 6);
    expect(warContractFactor(s, "prussia", W)).toBe(2);
    expect(warBondDiscount(s, "prussia", W)).toBe(0.06);
    expect(warContractFactor(s, "naples", W)).toBe(1);
    expect(warBondDiscount(s, "naples", W)).toBe(0);
  });

  it("take back every shift in risk and trade at peace, leaving events' own shifts alone", () => {
    const s = game();
    s.risk_shift.france = 0.05; // an event's shift
    s.trade_risk = 0.8; // and an event's trade factor
    for (let i = 0; i < 4; i++) {
      resolveWar(s, createRng(0), W);
      s.world.turn += 1;
      s.world.quarter = (s.world.quarter + 1) as 1 | 2 | 3 | 4;
    }
    expect(s.war.campaigns["hundred-days-1815"]!.stage).toBe("over");
    expect(s.risk_shift.france).toBeCloseTo(0.05, 6);
    for (const st of ["prussia", "austria", "bavaria"]) expect(s.risk_shift[st] ?? 0).toBeCloseTo(0, 6);
    expect(s.trade_risk).toBeCloseTo(0.8, 6);
  });

  it("shock prices once when a phase begins", () => {
    const s = game();
    const shares = s.markets.companies.map((c) => c.shock);
    const grain = s.markets.commodities.grain!.shock;
    resolveWar(s, createRng(0), W);
    expect(s.markets.commodities.grain!.shock).toBeCloseTo(grain * 1.08, 6);
    s.markets.companies.forEach((c, i) => expect(c.shock).toBeCloseTo(shares[i]! * 0.95, 6));
  });
});

describe("war loans", () => {
  it("lend at par: cash out, the book in, one action used, the ledger matching", () => {
    const s = game();
    const n = lend(s, "prussia-1815", 10000);
    expect(n.house.cash).toBe(s.house.cash - 10000);
    expect(warBook(n)).toBe(10000);
    expect(netWorth(n)).toBe(netWorth(s));
    expect(n.actions_this_turn).toBe(s.actions_this_turn + 1);
    expect(n.war.loans[0]).toMatchObject({ borrower: "prussia", rate: 0.07, due_turn: 8, status: "active" });
    booksMatch(n);
    expect(openOffers(n, W).find((o) => o.offer.id === "prussia-1815")!.room).toBe(30000);
  });

  it("are refused when closed, too small, too large, beyond free cash, below the gate, or when bankrupt", () => {
    const s = game();
    const check = (offer: string, amount: number, st = s) => applyDecision(st, { kind: "subscribe_war_loan", offer, amount }, W);
    expect(check("austria-1848", 5000)).toMatchObject({ ok: false, reason: expect.stringMatching(/open/) });
    expect(check("prussia-1815", 500)).toMatchObject({ ok: false, reason: expect.stringMatching(/at least/) });
    expect(check("prussia-1815", 1500.5)).toMatchObject({ ok: false, reason: expect.stringMatching(/whole/) });
    expect(check("prussia-1815", 40001)).toMatchObject({ ok: false, reason: expect.stringMatching(/no more than/) });
    const broke = game();
    broke.house.cash = 0;
    expect(check("prussia-1815", 1000, broke)).toMatchObject({ ok: false, reason: expect.stringMatching(/cash/) });
    const low = game();
    low.house.reputation = 10;
    expect(check("prussia-1815", 1000, low)).toMatchObject({ ok: false, reason: expect.stringMatching(/reputation/) });
    const bankrupt = game();
    bankrupt.house.status = "bankrupt";
    expect(check("prussia-1815", 1000, bankrupt).ok).toBe(false);
  });

  it("pay interest each quarter and repay at the end of the term", () => {
    let s = lend(game(), "prussia-1815", 10000);
    const cash = s.house.cash;
    for (let turn = 1; turn <= 8; turn++) {
      s.world.turn = turn;
      serviceWarLoans(s, always(0.99), W);
    }
    expect(s.war.loans[0]!.status).toBe("repaid");
    expect(s.house.cash).toBe(cash + 8 * 175 + 10000);
    booksMatch(s);
  });

  it("fail at the end of the term on a roll weighed by bad fortune, recovering a share", () => {
    const s = lend(game(), "austria-1815", 10000);
    s.war.campaigns["hundred-days-1815"]!.fortune.austria = 2;
    expect(failChance(s, s.war.loans[0]!, W)).toBeCloseTo(0.05 * (1 + 0.5 * 2), 6);
    s.war.campaigns["hundred-days-1815"]!.fortune.austria = -2;
    expect(failChance(s, s.war.loans[0]!, W)).toBeCloseTo(0.05, 6);
    s.world.turn = 8;
    const cash = s.house.cash;
    serviceWarLoans(s, always(0), W);
    expect(s.war.loans[0]!.status).toBe("defaulted");
    expect(s.house.cash).toBe(cash + Math.round(10000 * 0.075 / 4) + 5000);
    booksMatch(s);
  });

  it("are lost without a roll when the borrower defaults on its bonds", () => {
    const s = lend(game(), "prussia-1815", 10000);
    s.defaulted_states.push("prussia");
    const cash = s.house.cash;
    serviceWarLoans(s, fixedRng(), W);
    expect(s.war.loans[0]!.status).toBe("defaulted");
    expect(s.house.cash).toBe(cash);
    expect(openOffers(s, W).some((o) => o.offer.borrower === "prussia")).toBe(false);
    booksMatch(s);
  });

  it("cost reputation once when they pay to put down a rising", () => {
    let s = at(game(), 1820, 4);
    const rep = s.house.reputation;
    s = lend(s, "austria-1821", 5000);
    expect(s.house.reputation).toBe(rep - 2);
    s.actions_this_turn = 0;
    s.counting.used = { deals: 0, reports: 0, opinions: 0, head: 0 };
    s = lend(s, "austria-1821", 5000);
    expect(s.house.reputation).toBe(rep - 2);
  });

  it("are sold at the loan discount in a forced sale, only the slice needed", () => {
    const s = lend(game(), "prussia-1815", 10000);
    const ratio = 1 - W.tuning.forced_sale.loan_discount;
    const raised = raiseFromWar(s, 4000, W.tuning, "to meet withdrawals");
    expect(raised).toBeGreaterThanOrEqual(4000);
    expect(raised).toBeLessThan(4000 + 2);
    const sold = 10000 - warBook(s);
    expect(Math.round(sold * ratio)).toBeGreaterThanOrEqual(4000);
    expect(Math.round((sold - 1) * ratio)).toBeLessThan(4000);
    expect(raised).toBe(Math.round(sold * ratio));
    booksMatch(s);
  });

  it("survive the head's death mid-campaign: the gate follows the new head's Connections", () => {
    const s = lend(game(), "prussia-1815", 10000);
    const head = s.people.find((p) => p.is_head)!;
    head.connections = 10;
    const before = warLoanGate(s, "prussia", W);
    succeed(s, W);
    const heir = s.people.find((p) => p.is_head)!;
    expect(heir.id).not.toBe(head.id);
    heir.connections = 1;
    expect(warLoanGate(s, "prussia", W)).toBeGreaterThan(before);
    expect(s.war.loans[0]!.status).toBe("active");
    expect(warBook(s)).toBe(10000);
  });
});

describe("bankruptcy mid-campaign", () => {
  it("leaves the war alone, and its loans still count in net worth", () => {
    const s = lend(game(), "prussia-1815", 10000);
    s.house.status = "bankrupt";
    const copy = structuredClone(s);
    resolveWar(s, createRng(0), W);
    expect(s).toEqual(copy);
    const without = structuredClone(s);
    without.war.loans = [];
    expect(netWorth(s) - netWorth(without)).toBe(10000);
  });
});

describe("a branch in a city at war", () => {
  it("Hamburg is at war under the Danish blockade, and its branch faces the war closure chance", () => {
    const s = at(game(), 1848, 1);
    endTurnQuietly(s);
    const hamburg = cityState(s, "hamburg")!;
    expect(hamburg.status).toBe("war");
    expect(closeChance(hamburg, undefined, W)).toBeCloseTo(Math.min(1, W.europe.branch.close.war * (1.4 - 5 / 10)), 6);
  });
});

/** Runs Europe's and the war's quarter on `s` with quiet data and the real history. */
function endTurnQuietly(s: GameState): void {
  const next = endTurn(s, [], createRng(5), W);
  Object.assign(s, next);
}

describe("unrest pressure", () => {
  const P: GameData = { ...W, war: { ...W.war, pressure: { ...gameData.war.pressure } } };

  it("follows its curve on straight lines", () => {
    const curve = [{ year: 1820, level: 20 }, { year: 1830, level: 60 }];
    expect(curveAt(curve, { year: 1815, quarter: 1 })).toBe(20);
    expect(curveAt(curve, { year: 1825, quarter: 1 })).toBe(40);
    expect(curveAt(curve, { year: 1840, quarter: 1 })).toBe(60);
  });

  it("rises toward the curve, more with dear grain and a panic, and warns as it climbs", () => {
    const s = at(game(P), 1847, 4);
    for (const id of Object.keys(s.war.pressure)) s.war.pressure[id] = 40;
    rollPressure(s, always(0.5), P, { year: 1848, quarter: 1 });
    const plain = s.war.pressure.berlin!;
    expect(plain).toBeCloseTo(40 + 0.35 * (80 - 40), 1);
    const dear = at(game(P), 1847, 4);
    for (const id of Object.keys(dear.war.pressure)) dear.war.pressure[id] = 40;
    dear.markets.commodities.grain!.price *= 1.5;
    expect(grainDearness(dear, P)).toBeGreaterThan(0.4);
    cityState(dear, "berlin")!.mood = "panic";
    rollPressure(dear, always(0.5), P, { year: 1848, quarter: 1 });
    expect(dear.war.pressure.berlin!).toBeGreaterThan(plain + 0.35 * 10);
    expect(dear.news.some((n) => n.title === "Discontent in Berlin")).toBe(true);
  });

  it("is let out while a city is in unrest", () => {
    const s = at(game(P), 1847, 4);
    s.war.pressure.paris = 60;
    s.war.pressure.berlin = 60;
    cityState(s, "paris")!.status = "unrest";
    rollPressure(s, always(0.5), P, { year: 1848, quarter: 1 });
    expect(s.war.pressure.paris!).toBeLessThan(s.war.pressure.berlin! + 10);
  });

  it("makes random unrest abroad likelier, and adds a little to its state's risk", () => {
    const s = at(game(P), 1836, 1, P);
    for (const id of Object.keys(s.war.pressure)) s.war.pressure[id] = 0;
    s.war.pressure.paris = 75;
    expect(unrestFactor(s, "paris", P)).toBeCloseTo(2.5, 6);
    // A roll that keeps the peace at the city's own chance starts unrest at the scaled chance.
    const chance = P.europe.cities.find((c) => c.id === "paris")!.unrest_chance;
    expect(nextStatus({ status: "peace", status_left: 0 }, chance, chance * 1.5, P.europe).status).toBe("peace");
    expect(nextStatus({ status: "peace", status_left: 0 }, chance * unrestFactor(s, "paris", P), chance * 1.5, P.europe).status).toBe("unrest");
    expect(wantedRisk(s, P).france).toBeCloseTo(0.75 * 0.05, 6);
    expect(unrestFactor(s, "paris", quiet)).toBe(1);
  });
});

describe("Frankfurt's own troubles", () => {
  it("the September rising puts Frankfurt at war for a quarter, with trade risk, then peace", () => {
    // Frankfurt alone: the 1848 campaigns' own trade factors are left out.
    const H: GameData = { ...W, war: { ...W.war, campaigns: [] } };
    const s = at(game(H), 1848, 2, H);
    rollHome(s, always(0.99), H, { year: 1848, quarter: 3 });
    const f = cityState(s, "frankfurt")!;
    expect(f.status).toBe("war");
    expect(f.known.status).toBe("war");
    expect(s.news.some((n) => n.title === "Barricades in Frankfurt")).toBe(true);
    syncEffects(s, H);
    expect(s.trade_risk).toBeCloseTo(1.1, 6);
    at(s, 1848, 3, H);
    rollHome(s, always(0.99), H, { year: 1848, quarter: 4 });
    expect(f.status).toBe("peace");
    syncEffects(s, H);
    expect(s.trade_risk).toBeCloseTo(1, 6);
  });

  it("news-only happenings fire once and let out pressure", () => {
    const s = at(game(), 1848, 1);
    s.war.pressure.frankfurt = 50;
    rollHome(s, always(0.99), W, { year: 1848, quarter: 2 });
    rollHome(s, always(0.99), W, { year: 1848, quarter: 2 });
    expect(s.news.filter((n) => n.title === "A parliament for Germany")).toHaveLength(1);
    expect(s.war.pressure.frankfurt).toBe(40);
    expect(cityState(s, "frankfurt")!.status).toBe("peace");
  });

  it("high pressure may start a quarter of unrest on a low roll", () => {
    const P: GameData = { ...W, war: { ...W.war, pressure: gameData.war.pressure } };
    const s = at(game(P), 1846, 1, P);
    s.war.pressure.frankfurt = 90;
    rollHome(s, always(0.01), P, { year: 1846, quarter: 2 });
    expect(cityState(s, "frankfurt")!.status).toBe("unrest");
    const calm = at(game(P), 1846, 1, P);
    calm.war.pressure.frankfurt = 50;
    rollHome(calm, always(0), P, { year: 1846, quarter: 2 });
    expect(cityState(calm, "frankfurt")!.status).toBe("peace");
  });
});

describe("a run with the war", () => {
  function play(): GameState {
    const rng = createRng(11);
    let s = newGame(gameData, rng);
    s.house.reputation = 70;
    for (let t = 0; t < 24; t++) {
      const offer = openOffers(s, gameData)[0];
      const ds = offer ? [{ kind: "subscribe_war_loan" as const, offer: offer.offer.id, amount: 2000 }].filter((d) => applyDecision(s, d, gameData).ok) : [];
      s = endTurn(s, ds, rng, gameData);
      booksMatch(s);
    }
    return s;
  }

  it("keeps the ledger matching, is the same on a replay, and saves and loads", () => {
    const a = play();
    expect(a.war).toEqual(play().war);
    expect(a.war.loans.length).toBeGreaterThan(0);
    const r = parseSave(toSave(a, 11, 1, []), gameData);
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
  });
});
