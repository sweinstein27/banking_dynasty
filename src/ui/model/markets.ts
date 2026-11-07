// The Markets panel: the bourse's companies, the goods trade, the year's harvest and the house's
// ventures as long projects. Built only from the sim's own functions in src/sim/markets/ and
// src/sim/ventures.ts; nothing here shows a company's true earnings or fair value.
import {
  checkBuyCommodity,
  checkCompanyReport,
  checkBuyShares,
  checkSellCommodity,
  checkSellShares,
  commodityCost,
  goodsHeld,
  goodsValue,
  holdingValue,
  shareCost,
  sharesHeld,
  spaceUsed,
  warehouseSpace,
} from "../../sim/markets/holdings";
import { commodityTarget, earningsEstimate, harvestIndex, outcome, sectorOf, tradeFactor } from "../../sim/markets/prices";
import type { Company, CommodityType } from "../../sim/markets/types";
import type { GameData } from "../../sim/tuning";
import type { GameState, Venture } from "../../sim/types";
import { checkSellVenture, nextCall, quartersLeft, remainingCommitment, stakeSalePrice, ventureType } from "../../sim/ventures";

/** Prices of goods and shares to the kreuzer: 10.25 fl. */
export const price = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} fl.`;

export interface CompanyRow {
  id: string;
  name: string;
  sector: string;
  status: Company["status"];
  price: number;
  /** Dividend per share paid at the last year end, and as a yield on today's price. */
  dividend: number;
  yield: number;
  held: number;
  value: number;
  /** In other hands: the most the house could buy. */
  available: number;
  /** The house's view of yearly earnings, with the report it rests on. */
  estimate: { low: number; high: number; source: string };
  /** The next report tier the house could buy, with its cost and why it is refused, or null at the top. */
  report: { tier: number; name: string; cost: number; blocked: string | null } | null;
  /** From the house's own venture. */
  floated: boolean;
  listYear: number | null;
}

/** Listed companies first (the house's holdings at the top), then those still to come. Failed ones only while held. */
export function companyRows(state: GameState, data: GameData): CompanyRow[] {
  const m = data.markets;
  const turn = state.world.turn;
  const rows = state.markets.companies
    .filter((c) => c.status !== "failed" || sharesHeld(state, c.id) > 0)
    .map((c): CompanyRow => {
      const est = earningsEstimate(c, turn, m);
      const nextTier = c.status === "listed" ? m.reports.findIndex((t, i) => i > (c.report_until >= turn ? c.report_tier : 0) && t.cost > 0) : -1;
      const type = m.companies.find((t) => t.id === c.id);
      return {
        id: c.id,
        name: c.name,
        sector: sectorOf(m, c.sector).name,
        status: c.status,
        price: c.price,
        dividend: c.last_dividend,
        yield: c.price > 0 ? c.last_dividend / c.price : 0,
        held: sharesHeld(state, c.id),
        value: holdingValue(state, c.id),
        available: c.shares - sharesHeld(state, c.id),
        estimate: { low: est.low, high: est.high, source: m.reports[est.tier]!.name },
        report: nextTier > 0 ? { tier: nextTier, name: m.reports[nextTier]!.name, cost: m.reports[nextTier]!.cost, blocked: checkCompanyReport(state, { kind: "company_report", company: c.id, tier: nextTier }, data) } : null,
        floated: c.venture !== null,
        listYear: type && c.status === "upcoming" ? type.list_year : null,
      };
    });
  const rank = (r: CompanyRow) => (r.status === "upcoming" ? 2 : r.held > 0 ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.listYear ?? 0) - (b.listYear ?? 0));
}

/** What a trade of `n` shares would cost or raise now, and why it is refused. */
export function shareTrade(state: GameState, id: string, n: number, side: "buy" | "sell", data: GameData): { amount: number; blocked: string | null } {
  const c = state.markets.companies.find((x) => x.id === id)!;
  if (side === "buy") return { amount: Number.isInteger(n) && n > 0 ? shareCost(c, n, data) : 0, blocked: checkBuyShares(state, { kind: "buy_shares", company: id, shares: n }, data) };
  const value = Number.isInteger(n) && n > 0 ? Math.round(n * c.price) : 0;
  return { amount: value - Math.round(value * data.markets.commission.shares), blocked: checkSellShares(state, { kind: "sell_shares", company: id, shares: n }, data) };
}

export type Trend = "up" | "down" | "level";

export interface GoodsRow {
  id: string;
  name: string;
  unit: string;
  price: number;
  /** Where the price is heading: toward this quarter's target. */
  trend: Trend;
  /** Today's price against a fair year's. */
  vsBase: number;
  held: number;
  value: number;
  /** Storage per unit per quarter, and on what is held. */
  storage: number;
  storageBill: number;
  spoilage: number;
  space: number;
}

/** The direction from `price` toward `target`: level within 2%. */
export function trendOf(price: number, target: number): Trend {
  return target > price * 1.02 ? "up" : target < price * 0.98 ? "down" : "level";
}

export function goodsRows(state: GameState, data: GameData): GoodsRow[] {
  const { year, quarter } = state.world;
  return data.markets.commodities.map((t: CommodityType) => {
    const mk = state.markets.commodities[t.id]!;
    const held = goodsHeld(state, t.id);
    return {
      id: t.id,
      name: t.name,
      unit: t.unit,
      price: mk.price,
      trend: trendOf(mk.price, commodityTarget(t, state.markets, year, quarter, data.markets)),
      vsBase: mk.price / t.base_price,
      held,
      value: goodsValue(state, t.id),
      storage: t.storage,
      storageBill: Math.round(held * t.storage),
      spoilage: t.spoilage,
      space: t.space,
    };
  });
}

/** The house's warehouse: space in units, used and free. */
export function warehouse(state: GameState, data: GameData): { space: number; used: number; free: number } {
  const space = warehouseSpace(state, data);
  const used = spaceUsed(state, data);
  return { space, used, free: Math.max(0, space - used) };
}

/** The most units of a commodity the warehouse could still take. */
export function roomFor(state: GameState, id: string, data: GameData): number {
  const t = data.markets.commodities.find((x) => x.id === id)!;
  return Math.floor(warehouse(state, data).free / t.space);
}

export function goodsTrade(state: GameState, id: string, n: number, side: "buy" | "sell", data: GameData): { amount: number; blocked: string | null } {
  if (side === "buy") return { amount: Number.isInteger(n) && n > 0 ? commodityCost(state, id, n, data) : 0, blocked: checkBuyCommodity(state, { kind: "buy_commodity", commodity: id, units: n }, data) };
  const value = Number.isInteger(n) && n > 0 ? Math.round(n * state.markets.commodities[id]!.price) : 0;
  return { amount: value - Math.round(value * data.markets.commission.commodities), blocked: checkSellCommodity(state, { kind: "sell_commodity", commodity: id, units: n }, data) };
}

export interface HarvestView {
  regions: { id: string; name: string; outcome: string; index: number }[];
  /** Output of every region against a fair year, weighted. */
  index: number;
  goods: { name: string; regions: string; trend: Trend }[];
  trades: { trade: string; factor: number }[];
}

/** This year's harvest by region, and what it moves. */
export function harvestView(state: GameState, data: GameData): HarvestView {
  const m = data.markets;
  const h = state.markets.harvest;
  const regionName = (id: string) => m.regions.find((r) => r.id === id)?.name ?? id;
  return {
    regions: m.regions.map((r) => {
      const o = outcome(m, h[r.id] ?? "fair");
      return { id: r.id, name: r.name, outcome: o.name, index: o.index };
    }),
    index: harvestIndex(h, m.regions.map((r) => r.id), m),
    goods: goodsRows(state, data)
      .map((g) => ({ g, t: m.commodities.find((c) => c.id === g.id)! }))
      .filter(({ t }) => t.harvest)
      .map(({ g, t }) => ({ name: t.name, regions: t.harvest!.regions.map(regionName).join(", "), trend: g.trend })),
    trades: Object.keys(m.trades).map((trade) => ({ trade, factor: tradeFactor(state, trade, data) })),
  };
}

export interface VentureRow {
  id: number;
  name: string;
  tier: string;
  status: Venture["status"];
  phase: Venture["phase"];
  /** Calls paid, calls planned at the start, calls now (overruns add calls). */
  callsPaid: number;
  callsPlanned: number;
  calls: number;
  overrunCalls: number;
  committed: number;
  called: number;
  invested: number;
  /** Still to be called, and the next call. */
  toCome: number;
  next: number;
  /** Quarters until the build is done (0 once running). */
  buildLeft: number;
  sections: { open: number; of: number };
  /** Earnings on the house's stake over the last four quarters. */
  earnings: number;
  /** The company it floated as, with its price and the house's shares. */
  listing: { company: string; price: number; held: number; value: number; failed: boolean } | null;
  /** Running: quarters it must prove itself before it may float. */
  proveLeft: number | null;
  sale: { price: number; blocked: string | null } | null;
}

export function ventureRows(state: GameState, data: GameData): VentureRow[] {
  return state.ventures
    .filter((v) => v.status === "active" || v.status === "listed")
    .map((v) => {
      const t = ventureType(data, v.type);
      const c = v.company ? state.markets.companies.find((x) => x.id === v.company) : undefined;
      const running = v.phase === "running";
      const ranFor = v.run_start_turn !== null ? state.world.turn - v.run_start_turn : 0;
      return {
        id: v.id,
        name: t.name,
        tier: t.tier,
        status: v.status,
        phase: v.phase,
        callsPaid: v.calls_paid,
        callsPlanned: t.calls,
        calls: v.calls,
        overrunCalls: Math.max(0, v.calls - t.calls),
        committed: v.committed,
        called: v.called,
        invested: v.invested,
        toCome: remainingCommitment(v),
        next: nextCall(v),
        buildLeft: running ? 0 : Math.max(0, quartersLeft(state, v)),
        sections: { open: v.sections_open, of: t.sections },
        earnings: v.earnings.reduce((s, x) => s + x, 0),
        listing: c ? { company: c.name, price: c.price, held: sharesHeld(state, c.id), value: holdingValue(state, c.id), failed: c.status === "failed" } : null,
        proveLeft: running && v.status === "active" && t.tier !== "short" ? Math.max(0, t.prove_quarters - ranFor) : null,
        sale: v.status === "active" ? { price: stakeSalePrice(v.invested, data.tuning), blocked: checkSellVenture(state, { kind: "sell_venture", venture: v.id }, data) } : null,
      };
    });
}
