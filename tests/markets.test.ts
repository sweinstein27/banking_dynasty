import { describe, expect, it } from "vitest";
import { gameData } from "../src/data";
import { applyDecision } from "../src/sim/decisions";
import { newGame } from "../src/sim/init";
import { accountBalance } from "../src/sim/ledger";
import { raiseCash } from "../src/sim/liquidity";
import { chargeStorage, company, earningsEstimateFor, sharesHeld, spaceUsed, warehouseSpace } from "../src/sim/markets/holdings";
import {
  commodityBounds,
  commodityTarget,
  dividendPerShare,
  fairStrength,
  fairValue,
  harvestIndex,
  newCompany,
  nextCommodityPrice,
  nextSharePrice,
  pickOutcome,
  rollHarvest,
  sectorOf,
  tradeFactor,
} from "../src/sim/markets/prices";
import { createRng } from "../src/sim/rng";
import { parseSave, toSave } from "../src/sim/save";
import { commoditiesBook, createMarkets, markMarkets, marketsBook, sharesBook, stepMark, stepMarkets } from "../src/sim/systems/markets";
import { endTurn, netWorth } from "../src/sim/turn";
import type { Decision, GameState } from "../src/sim/types";
import { fixedRng, fresh, noDefaults, quiet } from "./helpers";

const m = gameData.markets;
const grain = m.commodities.find((c) => c.id === "grain")!;

function applyOk(state: GameState, d: Decision): GameState {
  const r = applyDecision(state, d, gameData);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

/** A fresh game in 1846 with every company due by then listed. */
function bourse(): GameState {
  const s = fresh();
  s.world.year = 1846;
  for (const c of s.markets.companies) {
    const t = m.companies.find((x) => x.id === c.id)!;
    if (t.list_year <= 1846) Object.assign(c, { status: "listed", listed_turn: 1 });
  }
  return s;
}

function reconcilesMarkets(s: GameState) {
  expect(accountBalance(s, "cash")).toBe(s.house.cash);
  expect(accountBalance(s, "shares")).toBe(sharesBook(s));
  expect(accountBalance(s, "commodities")).toBe(commoditiesBook(s));
}

describe("markets data", () => {
  it("has unique ids, known sectors and regions, and dates in the run", () => {
    for (const list of [m.commodities, m.sectors, m.companies, m.regions, m.news]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const sectors = m.sectors.map((s) => s.id);
    const regions = m.regions.map((r) => r.id);
    for (const c of m.companies) {
      expect(sectors).toContain(c.sector);
      expect(c.list_year).toBeGreaterThanOrEqual(1815);
      expect(c.list_year).toBeLessThanOrEqual(1850);
    }
    expect(m.companies.filter((c) => c.list_year < 1835).length).toBeLessThanOrEqual(5);
    expect(Math.min(...m.companies.filter((c) => c.sector === "railway").map((c) => c.list_year))).toBeGreaterThanOrEqual(1836);
    for (const c of m.commodities) for (const r of c.harvest?.regions ?? []) expect(regions).toContain(r);
    for (const id of Object.keys(m.event_shocks)) expect(gameData.events.map((e) => e.id)).toContain(id);
  });

  it("keeps utilities steadier than railways", () => {
    const u = sectorOf(m, "utility");
    const r = sectorOf(m, "railway");
    expect(u.price_noise).toBeLessThan(r.price_noise);
    expect(u.earnings_noise).toBeLessThan(r.earnings_noise);
    expect(u.mood_earnings.panic).toBeGreaterThan(r.mood_earnings.panic);
  });
});

describe("the price model", () => {
  it("keeps commodity prices within their bounds over 10,000 random quarters", () => {
    const rng = createRng(7);
    for (const type of m.commodities) {
      let p = type.base_price;
      for (let i = 0; i < 10000; i++) {
        const target = type.base_price * (0.2 + 4 * rng.next());
        p = nextCommodityPrice(p, target, 2 * rng.next() - 1, type, 1);
        const [lo, hi] = commodityBounds(type, 1);
        expect(p).toBeGreaterThanOrEqual(Math.floor(lo * 100) / 100);
        expect(p).toBeLessThanOrEqual(Math.ceil(hi * 100) / 100);
      }
    }
  });

  it("keeps share prices within their bounds around fair value, and above the minimum", () => {
    const rng = createRng(9);
    for (const sector of m.sectors) {
      let p = 250;
      for (let i = 0; i < 10000; i++) {
        const fair = 1 + 500 * rng.next();
        p = nextSharePrice(p, fair, 0.3 + 2 * rng.next(), 2 * rng.next() - 1, sector, m);
        expect(p).toBeGreaterThanOrEqual(Math.max(m.prices.min_price, Math.floor(fair * m.prices.bounds.min * 100) / 100));
        expect(p).toBeLessThanOrEqual(Math.max(m.prices.min_price, Math.ceil(fair * m.prices.bounds.max * 100) / 100));
      }
    }
  });

  it("brings a shocked price back toward its target", () => {
    let p = grain.base_price * 2;
    for (let i = 0; i < 12; i++) p = nextCommodityPrice(p, grain.base_price, 0, grain, 1);
    expect(p).toBeCloseTo(grain.base_price, 0);
  });

  it("prices a share on its dividends at the required yield, rising with the mood's premium", () => {
    const c = newCompany(m.companies[0]!, m, "calm", 1, 0);
    const dps = dividendPerShare(c);
    expect(dps).toBeCloseTo(250 * 0.06 * 0.8, 1);
    expect(fairValue(c, "calm", m)).toBeCloseTo(dps / 0.05, 0);
    expect(fairValue(c, "panic", m)).toBeLessThan(fairValue(c, "uneasy", m));
    c.earnings = [-100, -100, -100, -100];
    expect(fairValue(c, "calm", m)).toBe(250 * m.prices.distress_value);
  });

  it("gives the same prices from the same seed", () => {
    const play = () => {
      let s = newGame(quiet, createRng(5));
      for (let i = 0; i < 30; i++) s = endTurn(s, [], createRng(100 + i), quiet);
      return JSON.stringify(s.markets);
    };
    expect(play()).toBe(play());
  });
});

describe("harvests", () => {
  it("picks outcomes by weight and takes history over the roll", () => {
    expect(pickOutcome(m, 0).id).toBe("failed");
    expect(pickOutcome(m, 0.999).id).toBe("bumper");
    expect(rollHarvest(m, 1816, fixedRng(0.5))).toEqual({ rhine: "failed", north: "poor", south: "failed" });
    expect(rollHarvest(m, 1847, fixedRng(0))).toEqual({ rhine: "bumper", north: "bumper", south: "bumper" });
  });

  it("draws the same numbers in a historic year, so history does not shift the stream", () => {
    let a = 0;
    let b = 0;
    rollHarvest(m, 1816, { next: () => (a++, 0.5) });
    rollHarvest(m, 1820, { next: () => (b++, 0.5) });
    expect(a).toBe(b);
  });

  it("raises grain's target after a failed harvest, and hurts grain dealers' loans", () => {
    const s = fresh();
    const fair = commodityTarget(grain, s.markets, 1817, 1, m);
    s.markets.harvest = { rhine: "failed", north: "failed", south: "failed" };
    expect(harvestIndex(s.markets.harvest, ["rhine"], m)).toBe(0.6);
    expect(commodityTarget(grain, s.markets, 1817, 1, m) / fair).toBeCloseTo(0.6 ** -1.5);
    expect(tradeFactor(s, "grain dealer", gameData)).toBe(2);
    expect(tradeFactor(s, "silk", gameData)).toBe(1);
  });

  it("is rolled at the end of Q3 and reported", () => {
    const s = fresh();
    s.world.quarter = 3;
    stepMark(s, fixedRng(0.5), gameData);
    expect(Object.keys(s.markets.harvest)).toEqual(["rhine", "north", "south"]);
    expect(s.news.at(-1)).toMatchObject({ kind: "markets", title: "The harvest" });
  });

  it("lifts wine and cloth in the fair quarters, less once the fairs fade after 1830", () => {
    expect(fairStrength(1825, m)).toBe(1);
    expect(fairStrength(1840, m)).toBe(m.fairs.floor);
    const cloth = m.commodities.find((c) => c.id === "cloth")!;
    const s = fresh();
    expect(commodityTarget(cloth, s.markets, 1820, 2, m) / commodityTarget(cloth, s.markets, 1820, 1, m)).toBeCloseTo(1.08);
  });
});

describe("the bourse", () => {
  it("lists nothing at the start and companies when history allows, with news", () => {
    const s = fresh();
    expect(s.markets.companies.every((c) => c.status === "upcoming")).toBe(true);
    s.world.year = 1819;
    s.world.quarter = 4;
    stepMark(s, fixedRng(0.5), gameData);
    expect(company(s, "danube_bank")).toMatchObject({ status: "listed", listed_turn: 2 });
    expect(s.news.at(-1)).toMatchObject({ title: "New on the bourse" });
  });

  it("buys and sells shares through capacity, cash and the float, with commission", () => {
    const s0 = bourse();
    const c = company(s0, "main_gas")!;
    const s1 = applyOk(s0, { kind: "buy_shares", company: "main_gas", shares: 100 });
    const value = Math.round(100 * c.price);
    expect(s1.house.cash).toBe(s0.house.cash - value - Math.round(value * 0.005));
    expect(sharesHeld(s1, "main_gas")).toBe(100);
    expect(s1.actions_this_turn).toBe(1);
    expect(netWorth(s1)).toBe(netWorth(s0) - Math.round(value * 0.005));
    reconcilesMarkets(s1);
    const s2 = applyOk(s1, { kind: "sell_shares", company: "main_gas", shares: 40 });
    expect(sharesHeld(s2, "main_gas")).toBe(60);
    reconcilesMarkets(s2);
    expect(applyDecision(s0, { kind: "buy_shares", company: "main_gas", shares: c.shares + 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/other hands/) });
    expect(applyDecision(s0, { kind: "sell_shares", company: "main_gas", shares: 1 }, gameData)).toMatchObject({ ok: false });
    expect(applyDecision(fresh(), { kind: "buy_shares", company: "main_gas", shares: 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/not listed/) });
  });

  it("refuses to buy with zero cash", () => {
    const s = bourse();
    s.house.cash = 0;
    expect(applyDecision(s, { kind: "buy_shares", company: "main_gas", shares: 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/Not enough cash/) });
    expect(applyDecision(s, { kind: "buy_commodity", commodity: "grain", units: 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/Not enough cash/) });
  });

  it("pays dividends at year end on shares held", () => {
    const s = applyOk(bourse(), { kind: "buy_shares", company: "main_gas", shares: 100 });
    s.world.quarter = 4;
    const cash = s.house.cash;
    stepMarkets(s, fixedRng(0.5), gameData);
    const c = company(s, "main_gas")!;
    expect(c.last_dividend).toBeGreaterThan(0);
    expect(s.house.cash).toBe(cash + Math.round(100 * c.last_dividend));
    expect(s.ledger.at(-1)).toMatchObject({ category: "dividend" });
  });

  it("writes off the shares of a company that fails after a year of losses", () => {
    const s = applyOk(bourse(), { kind: "buy_shares", company: "saar_iron", shares: 50 });
    company(s, "saar_iron")!.earnings = [-5000, -5000, -5000];
    stepMarkets(s, fixedRng(0, 0), gameData);
    expect(company(s, "saar_iron")!.status).toBe("failed");
    expect(sharesHeld(s, "saar_iron")).toBe(0);
    expect(accountBalance(s, "shares")).toBe(0);
  });

  it("marks holdings to new prices and records the change", () => {
    const s = applyOk(bourse(), { kind: "buy_shares", company: "nidda_railway", shares: 100 });
    company(s, "nidda_railway")!.shock = 0.5;
    const before = sharesBook(s);
    stepMark(s, fixedRng(0.5), gameData);
    expect(sharesBook(s)).toBeLessThan(before);
    expect(s.ledger.at(-1)).toMatchObject({ category: "market_revaluation", account: "shares" });
    reconcilesMarkets(s);
  });

  it("moves prices on the events that just fired", () => {
    const s = bourse();
    s.fired_events.push({ id: "february-revolution-1848", turn: s.world.turn });
    stepMark(s, fixedRng(0.5), gameData);
    expect(company(s, "main_gas")!.shock).toBeCloseTo(0.75);
  });

  it("narrows the earnings estimate with a report, and always contains the truth", () => {
    const s0 = bourse();
    const wide = earningsEstimateFor(s0, "saar_iron", gameData);
    const s1 = applyOk(s0, { kind: "company_report", company: "saar_iron", tier: 2 });
    const exact = earningsEstimateFor(s1, "saar_iron", gameData);
    const truth = company(s1, "saar_iron")!.earnings.reduce((a, b) => a + b, 0);
    expect(wide.low).toBeLessThanOrEqual(truth);
    expect(wide.high).toBeGreaterThanOrEqual(truth);
    expect(exact).toMatchObject({ low: truth, high: truth, tier: 2 });
    expect(s1.house.cash).toBe(s0.house.cash - 2000);
    expect(applyDecision(s1, { kind: "company_report", company: "saar_iron", tier: 1 }, gameData)).toMatchObject({ ok: false });
  });
});

describe("commodities and the warehouse", () => {
  it("buys within warehouse space and sells back", () => {
    const s0 = fresh();
    const space = warehouseSpace(s0, gameData);
    expect(applyDecision(s0, { kind: "buy_commodity", commodity: "grain", units: space + 1 }, gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/warehouse space/) });
    const s1 = applyOk(s0, { kind: "buy_commodity", commodity: "grain", units: 1000 });
    expect(spaceUsed(s1, gameData)).toBe(1000);
    reconcilesMarkets(s1);
    const s2 = applyOk(s1, { kind: "sell_commodity", commodity: "grain", units: 1000 });
    expect(s2.markets.goods).toEqual({});
    expect(s2.house.cash).toBeLessThan(s0.house.cash);
    reconcilesMarkets(s2);
  });

  it("charges storage and takes spoilage each quarter", () => {
    const s = applyOk(fresh(), { kind: "buy_commodity", commodity: "grain", units: 1000 });
    const cash = s.house.cash;
    chargeStorage(s, gameData);
    expect(s.markets.goods.grain).toBe(980);
    expect(s.house.cash).toBe(cash - Math.round(980 * 0.15));
    reconcilesMarkets(s);
  });

  it("sells goods to pay storage when cash is zero, never going below zero", () => {
    const s = applyOk(fresh(), { kind: "buy_commodity", commodity: "wine", units: 100 });
    s.house.cash = 0;
    s.ledger.push({ id: s.next_ledger_id++, turn: 1, account: "cash", category: "event", amount: -accountBalance(s, "cash"), note: "Test: cash to zero" });
    chargeStorage(s, gameData);
    expect(s.house.cash).toBeGreaterThanOrEqual(0);
    expect(s.markets.goods.wine).toBeLessThan(100);
    expect(s.ledger.some((e) => e.category === "storage")).toBe(true);
    reconcilesMarkets(s);
  });
});

describe("the markets in the house's books", () => {
  it("counts shares and goods in net worth", () => {
    const s0 = bourse();
    const s1 = applyOk(applyOk(s0, { kind: "buy_shares", company: "main_gas", shares: 10 }), { kind: "buy_commodity", commodity: "iron", units: 10 });
    expect(marketsBook(s1)).toBe(sharesBook(s1) + commoditiesBook(s1));
    expect(marketsBook(s1)).toBeGreaterThan(0);
    // Only the brokers' commissions leave the books.
    const paid = s1.ledger.filter((e) => e.account === "cash" && e.id >= s0.next_ledger_id).reduce((a, e) => a + e.amount, 0);
    expect(netWorth(s0) - netWorth(s1)).toBe(-paid - marketsBook(s1));
  });

  it("sells shares and goods in a run, after bonds and before loans", () => {
    const s = applyOk(applyOk(bourse(), { kind: "buy_shares", company: "main_gas", shares: 100 }), { kind: "buy_commodity", commodity: "grain", units: 500 });
    const raised = raiseCash(s, 30000, gameData.tuning);
    expect(raised).toBeGreaterThanOrEqual(Math.min(30000, 1));
    expect(sharesHeld(s, "main_gas")).toBeLessThan(100);
    reconcilesMarkets(s);
  });

  it("goes bankrupt with market holdings when even selling them cannot pay depositors", () => {
    let s = applyOk(bourse(), { kind: "buy_shares", company: "main_gas", shares: 100 });
    s.house.deposits = 5_000_000;
    s.ledger.push({ id: s.next_ledger_id++, turn: 1, account: "deposits", category: "opening", amount: 5_000_000 - accountBalance(s, "deposits"), note: "Test deposits" });
    s.world.sentiment = "panic";
    s = endTurn(s, [], noDefaults, quiet);
    expect(s.house.status).toBe("bankrupt");
    expect(sharesHeld(s, "main_gas")).toBe(0);
  });

  it("saves and loads with holdings, and refuses a save whose shares do not match the ledger", () => {
    const s = applyOk(bourse(), { kind: "buy_shares", company: "main_gas", shares: 10 });
    const ok = parseSave(toSave(s, 1, 1, []), gameData);
    expect(ok.ok).toBe(true);
    s.markets.shares.main_gas = 11;
    expect(parseSave(toSave(s, 1, 1, []), gameData)).toMatchObject({ ok: false, reason: expect.stringMatching(/shares/) });
  });

  it("seeds its own stream with one draw at the start", () => {
    let n = 0;
    createMarkets(gameData, { next: () => (n++, 0.25) });
    expect(n).toBe(1);
    const s = fresh();
    const before = s.markets.rng_state;
    markMarkets(s, gameData);
    expect(s.markets.rng_state).not.toBe(before);
  });
});
