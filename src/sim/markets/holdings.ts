// The house's market holdings: shares and goods, their books, trades, storage and forced sales.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { freeCash } from "../reserves";
import { cloneState } from "../state";
import type { GameData, Tuning } from "../tuning";
import type { GameState } from "../types";
import { commodityType, earningsEstimate } from "./prices";
import type { BuyCommodityDecision, BuySharesDecision, Company, CompanyReportDecision, SellCommodityDecision, SellSharesDecision } from "./types";

// Books ---------------------------------------------------------------------------------------

export const company = (state: GameState, id: string): Company | undefined => state.markets.companies.find((c) => c.id === id);

/** Shares of `id` held. */
export const sharesHeld = (state: GameState, id: string) => state.markets.shares[id] ?? 0;
export const goodsHeld = (state: GameState, id: string) => state.markets.goods[id] ?? 0;

/** Book value of the house's shares in one company: units at the last price, whole gulden. */
export function holdingValue(state: GameState, id: string): number {
  const c = company(state, id);
  return c ? Math.round(sharesHeld(state, id) * c.price) : 0;
}

export function goodsValue(state: GameState, id: string): number {
  const mk = state.markets.commodities[id];
  return mk ? Math.round(goodsHeld(state, id) * mk.price) : 0;
}

/** Every shareholding at its last price. */
export function sharesBook(state: GameState): number {
  return Object.keys(state.markets.shares).reduce((s, id) => s + holdingValue(state, id), 0);
}

/** Every commodity holding at its last price. */
export function commoditiesBook(state: GameState): number {
  return Object.keys(state.markets.goods).reduce((s, id) => s + goodsValue(state, id), 0);
}

/**
 * Warehouse space the house has for goods. The counting house (A2) owns the warehouse; until it
 * merges this is a fixed amount from data/markets.json. See docs/notes/A3-markets.md.
 */
export function warehouseSpace(_state: GameState, data: GameData): number {
  return data.markets.warehouse.default_space;
}

export function spaceUsed(state: GameState, data: GameData): number {
  return Object.entries(state.markets.goods).reduce((s, [id, n]) => s + n * (commodityType(data.markets, id)?.space ?? 0), 0);
}

/** Broker's commission on a trade of `value`, whole gulden. */
export const commission = (value: number, share: number) => Math.round(value * share);

/** Sets a holding, dropping it when it reaches zero. */
function setHolding(book: Record<string, number>, id: string, n: number): void {
  if (n > 0) book[id] = n;
  else delete book[id];
}

// Shares --------------------------------------------------------------------------------------

/** What buying `n` shares costs now, commission included. */
export function shareCost(c: Company, n: number, data: GameData): number {
  const value = Math.round(n * c.price);
  return value + commission(value, data.markets.commission.shares);
}

export function checkBuyShares(state: GameState, d: BuySharesDecision, data: GameData): string | null {
  const c = company(state, d.company);
  if (!c) return `Unknown company "${d.company}"`;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (c.status !== "listed") return `${c.name} is not listed on the bourse`;
  if (!Number.isInteger(d.shares) || d.shares <= 0) return "Shares must be a whole number above zero";
  const available = c.shares - sharesHeld(state, c.id);
  if (d.shares > available) return `Only ${available} shares of ${c.name} are in other hands`;
  const cost = shareCost(c, d.shares, data);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (costs ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

export function buyShares(state: GameState, d: BuySharesDecision, data: GameData): DecisionResult {
  const reason = checkBuyShares(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = company(next, d.company)!;
  const before = holdingValue(next, c.id);
  setHolding(next.markets.shares, c.id, sharesHeld(next, c.id) + d.shares);
  const book = holdingValue(next, c.id) - before;
  const cost = shareCost(c, d.shares, data);
  next.house.cash -= cost;
  useCapacity(next, d.kind, data.tuning);
  const note = `${d.shares} shares of ${c.name} bought at ${fl(c.price)}`;
  addEntry(next, "cash", "share_purchase", -cost, note);
  addEntry(next, "shares", "share_purchase", book, note);
  return { ok: true, state: next };
}

export function checkSellShares(state: GameState, d: SellSharesDecision, data: GameData): string | null {
  const c = company(state, d.company);
  if (!c) return `Unknown company "${d.company}"`;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (c.status !== "listed") return `${c.name} is not traded on the bourse`;
  if (!Number.isInteger(d.shares) || d.shares <= 0) return "Shares must be a whole number above zero";
  if (d.shares > sharesHeld(state, c.id)) return `The house holds only ${sharesHeld(state, c.id)} shares of ${c.name}`;
  return null;
}

/** Sells `n` shares of `c` at `ratio` of the last price, less commission. Returns the cash raised. Mutates `state`. */
function sellSharesAt(state: GameState, c: Company, n: number, ratio: number, data: { commission: number }, note: string, category: "share_sale" | "forced_sale"): number {
  const before = holdingValue(state, c.id);
  setHolding(state.markets.shares, c.id, sharesHeld(state, c.id) - n);
  const value = Math.round(n * c.price * ratio);
  const proceeds = value - commission(value, data.commission);
  state.house.cash += proceeds;
  addEntry(state, "cash", category, proceeds, note);
  addEntry(state, "shares", category, holdingValue(state, c.id) - before, note);
  return proceeds;
}

export function sellShares(state: GameState, d: SellSharesDecision, data: GameData): DecisionResult {
  const reason = checkSellShares(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = company(next, d.company)!;
  sellSharesAt(next, c, d.shares, 1, { commission: data.markets.commission.shares }, `${d.shares} shares of ${c.name} sold at ${fl(c.price)}`, "share_sale");
  useCapacity(next, d.kind, data.tuning);
  return { ok: true, state: next };
}

// Commodities ---------------------------------------------------------------------------------

export function commodityCost(state: GameState, id: string, units: number, data: GameData): number {
  const value = Math.round(units * state.markets.commodities[id]!.price);
  return value + commission(value, data.markets.commission.commodities);
}

export function checkBuyCommodity(state: GameState, d: BuyCommodityDecision, data: GameData): string | null {
  const type = commodityType(data.markets, d.commodity);
  if (!type || !state.markets.commodities[d.commodity]) return `Unknown commodity "${d.commodity}"`;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (!Number.isInteger(d.units) || d.units <= 0) return "Units must be a whole number above zero";
  const free = warehouseSpace(state, data) - spaceUsed(state, data);
  if (d.units * type.space > free) return `Not enough warehouse space (needs ${d.units * type.space}, free ${free})`;
  const cost = commodityCost(state, d.commodity, d.units, data);
  if (cost > freeCash(state)) return `Not enough cash above the reserve (costs ${fl(cost)}, free ${fl(freeCash(state))})`;
  return null;
}

export function buyCommodity(state: GameState, d: BuyCommodityDecision, data: GameData): DecisionResult {
  const reason = checkBuyCommodity(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const type = commodityType(data.markets, d.commodity)!;
  const before = goodsValue(next, d.commodity);
  setHolding(next.markets.goods, d.commodity, goodsHeld(next, d.commodity) + d.units);
  const cost = commodityCost(state, d.commodity, d.units, data);
  next.house.cash -= cost;
  useCapacity(next, d.kind, data.tuning);
  const note = `${d.units} ${type.unit} of ${type.name.toLowerCase()} bought at ${fl(next.markets.commodities[d.commodity]!.price)}`;
  addEntry(next, "cash", "commodity_purchase", -cost, note);
  addEntry(next, "commodities", "commodity_purchase", goodsValue(next, d.commodity) - before, note);
  return { ok: true, state: next };
}

export function checkSellCommodity(state: GameState, d: SellCommodityDecision, data: GameData): string | null {
  const type = commodityType(data.markets, d.commodity);
  if (!type) return `Unknown commodity "${d.commodity}"`;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (!Number.isInteger(d.units) || d.units <= 0) return "Units must be a whole number above zero";
  if (d.units > goodsHeld(state, d.commodity)) return `The house holds only ${goodsHeld(state, d.commodity)} ${type.unit} of ${type.name.toLowerCase()}`;
  return null;
}

/** Sells `n` units at `ratio` of the last price, less commission. Returns the cash raised. Mutates `state`. */
function sellGoodsAt(state: GameState, id: string, n: number, ratio: number, commissionShare: number, note: string, category: "commodity_sale" | "forced_sale"): number {
  const before = goodsValue(state, id);
  setHolding(state.markets.goods, id, goodsHeld(state, id) - n);
  const value = Math.round(n * state.markets.commodities[id]!.price * ratio);
  const proceeds = value - commission(value, commissionShare);
  state.house.cash += proceeds;
  addEntry(state, "cash", category, proceeds, note);
  addEntry(state, "commodities", category, goodsValue(state, id) - before, note);
  return proceeds;
}

export function sellCommodity(state: GameState, d: SellCommodityDecision, data: GameData): DecisionResult {
  const reason = checkSellCommodity(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const type = commodityType(data.markets, d.commodity)!;
  const price = next.markets.commodities[d.commodity]!.price;
  sellGoodsAt(next, d.commodity, d.units, 1, data.markets.commission.commodities, `${d.units} ${type.unit} of ${type.name.toLowerCase()} sold at ${fl(price)}`, "commodity_sale");
  useCapacity(next, d.kind, data.tuning);
  return { ok: true, state: next };
}

// Company reports -----------------------------------------------------------------------------

/** The house's view of a company's yearly earnings, at the report tier it holds now. */
export function earningsEstimateFor(state: GameState, id: string, data: GameData): { low: number; high: number; tier: number } {
  return earningsEstimate(company(state, id)!, state.world.turn, data.markets);
}

export function checkCompanyReport(state: GameState, d: CompanyReportDecision, data: GameData): string | null {
  const c = company(state, d.company);
  if (!c) return `Unknown company "${d.company}"`;
  const tier = data.markets.reports[d.tier];
  if (!tier || d.tier < 1) return `Unknown report tier ${d.tier}`;
  const noCapacity = checkCapacity(state, d.kind, data.tuning);
  if (noCapacity) return noCapacity;
  if (c.status !== "listed") return `${c.name} is not listed on the bourse`;
  if (c.report_until >= state.world.turn && c.report_tier >= d.tier) return `The house already has ${data.markets.reports[c.report_tier]!.name} on ${c.name}`;
  if (tier.cost > freeCash(state)) return `Not enough cash above the reserve (costs ${fl(tier.cost)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Buys a report tier on a company's books: its earnings estimate narrows for the tier's quarters. */
export function buyCompanyReport(state: GameState, d: CompanyReportDecision, data: GameData): DecisionResult {
  const reason = checkCompanyReport(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  const c = company(next, d.company)!;
  const tier = data.markets.reports[d.tier]!;
  c.report_tier = d.tier;
  c.report_until = next.world.turn + tier.quarters - 1;
  next.house.cash -= tier.cost;
  useCapacity(next, d.kind, data.tuning);
  addEntry(next, "cash", "company_report", -tier.cost, `${tier.name[0]!.toUpperCase()}${tier.name.slice(1)} on ${c.name}`);
  return { ok: true, state: next };
}

// End Turn ------------------------------------------------------------------------------------

/**
 * Charges storage on goods held and takes spoilage. Storage is paid from cash, the reserve
 * included; when cash cannot cover a commodity's storage, enough of it is sold at the forced-sale
 * discount to pay. Mutates `state`.
 */
export function chargeStorage(state: GameState, data: GameData): void {
  for (const type of data.markets.commodities) {
    let held = goodsHeld(state, type.id);
    if (!held) continue;
    const lost = Math.round(held * type.spoilage);
    if (lost > 0) {
      const before = goodsValue(state, type.id);
      setHolding(state.markets.goods, type.id, held - lost);
      held -= lost;
      addEntry(state, "commodities", "spoilage", goodsValue(state, type.id) - before, `${lost} ${type.unit} of ${type.name.toLowerCase()} spoiled in the warehouse`);
    }
    if (!held) continue;
    const fee = Math.round(held * type.storage);
    if (state.house.cash < fee) {
      const ratio = 1 - data.tuning.forced_sale.commodity_discount;
      const perUnit = state.markets.commodities[type.id]!.price * ratio * (1 - data.markets.commission.commodities);
      const units = Math.min(held, Math.ceil((fee - state.house.cash) / Math.max(perUnit, 0.01)));
      sellGoodsAt(state, type.id, units, ratio, data.markets.commission.commodities, `${units} ${type.unit} of ${type.name.toLowerCase()} sold at a discount to pay for storage`, "forced_sale");
    }
    // What cash cannot cover even then is written off by the warehouse.
    const paid = Math.min(fee, Math.max(0, state.house.cash));
    if (paid <= 0) continue;
    state.house.cash -= paid;
    addEntry(state, "cash", "storage", -paid, `Storage of ${type.name.toLowerCase()}`);
  }
}
/**
 * Sells market holdings at a discount until `needed` cash is raised or none are left: shares
 * first (company order), then goods (data order). Only what is needed is sold. Returns the cash
 * raised. The discount stands in for the broker's commission. Mutates `state`; callers pass a draft copy.
 */
export function raiseFromMarkets(state: GameState, needed: number, tuning: Tuning, purpose: string): number {
  let raised = 0;
  const shareRatio = 1 - tuning.forced_sale.share_discount;
  for (const c of state.markets.companies) {
    if (raised >= needed) break;
    const held = sharesHeld(state, c.id);
    if (!held || c.status !== "listed") continue;
    const perShare = c.price * shareRatio;
    const n = Math.min(held, Math.max(1, Math.ceil((needed - raised) / Math.max(perShare, 0.01))));
    raised += sellSharesAt(state, c, n, shareRatio, { commission: 0 }, `${n} shares of ${c.name} sold at a discount ${purpose}`, "forced_sale");
  }
  const goodsRatio = 1 - tuning.forced_sale.commodity_discount;
  for (const id of Object.keys(state.markets.goods)) {
    if (raised >= needed) break;
    const held = goodsHeld(state, id);
    const perUnit = state.markets.commodities[id]!.price * goodsRatio;
    const n = Math.min(held, Math.max(1, Math.ceil((needed - raised) / Math.max(perUnit, 0.01))));
    raised += sellGoodsAt(state, id, n, goodsRatio, 0, `${n} units of ${id} sold at a discount ${purpose}`, "forced_sale");
  }
  return raised;
}
