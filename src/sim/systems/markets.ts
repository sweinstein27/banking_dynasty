// Markets (milestone A3): the Frankfurt bourse (companies with books, dividends and share prices),
// utilities, commodities with warehouse storage, yearly harvests, and long ventures that float as
// companies (src/sim/ventures.ts). The pieces live in src/sim/markets/; this file is the system's seam.
import type { DecisionResult } from "../actions";
import { fl } from "../format";
import { addEntry } from "../ledger";
import { createRng, type Rng } from "../rng";
import type { GameData } from "../tuning";
import type { Decision, GameState } from "../types";
import { sellVenture } from "../ventures";
import {
  buyCommodity,
  buyCompanyReport,
  buyShares,
  chargeStorage,
  commoditiesBook,
  company,
  goodsValue,
  holdingValue,
  sellCommodity,
  sellShares,
  sharesBook,
  sharesHeld,
} from "../markets/holdings";
import {
  applyShock,
  commodityTarget,
  dividendPerShare,
  driverFactor,
  earningCapital,
  fadeShocks,
  fairValue,
  growthFactor,
  newCompany,
  nextCommodityPrice,
  nextQuarter,
  nextSharePrice,
  outcome,
  quarterEarnings,
  rollHarvest,
  sectorOf,
  spread,
  trailingEarnings,
} from "../markets/prices";
import { withMarketsRng } from "../markets/stream";
import { sectorFactor } from "./progress";
import { MARKETS_KINDS, type MarketsDecision, type MarketsState } from "../markets/types";

export type { MarketsAccount, MarketsCategory, MarketsData, MarketsDecision, MarketsState } from "../markets/types";
export { tradeFactor } from "../markets/prices";
export { commoditiesBook, sharesBook, warehouseSpace } from "../markets/holdings";

const before = (a: { year: number; quarter: number }, b: { year: number; quarter: number }) => a.year < b.year || (a.year === b.year && a.quarter <= b.quarter);

/**
 * The markets at the start: one draw from the run's RNG seeds the markets' own stream, which then
 * places each company's earnings estimate. Companies listed by the start date trade from turn 1.
 */
export function createMarkets(data: GameData, rng: Rng): MarketsState {
  const m = data.markets;
  const stream = createRng(Math.floor(rng.next() * 0x100000000));
  const start = { year: data.tuning.start.year, quarter: data.tuning.start.quarter };
  const companies = m.companies.map((t) =>
    newCompany(t, m, data.tuning.start.sentiment, before({ year: t.list_year, quarter: t.list_quarter }, start) ? 1 : null, spread(stream)),
  );
  const harvest = Object.fromEntries(m.regions.map((r) => [r.id, "fair"]));
  const state: MarketsState = { rng_state: stream.state, companies, commodities: {}, harvest, shares: {}, goods: {} };
  for (const c of m.commodities) state.commodities[c.id] = { price: c.base_price, shock: 1, level: 1 };
  for (const c of m.commodities) state.commodities[c.id]!.price = Math.round(commodityTarget(c, state, start.year, start.quarter, m) * 100) / 100;
  return state;
}

function news(state: GameState, text: string, title?: string): void {
  state.news.push({ turn: state.world.turn, kind: "markets", text, ...(title ? { title } : {}) });
}

/**
 * The quarter's business, after ventures resolve and before depositors withdraw: every listed
 * company earns and may fail (in company order, two draws each; a trailing loss makes failure far
 * likelier), a failure writing off the house's shares; at year end dividends are declared and paid on shares held; goods
 * in the warehouse spoil a little and pay storage. Mutates `state`.
 */
export function resolveMarkets(state: GameState, _rng: Rng, data: GameData): void {
  withMarketsRng(state, (rng) => stepMarkets(state, rng, data));
}

export function stepMarkets(state: GameState, rng: Rng, data: GameData): void {
  const m = data.markets;
  const { sentiment } = state.world;
  for (const c of state.markets.companies) {
    if (c.status !== "listed") continue;
    const sector = sectorOf(m, c.sector);
    const e = quarterEarnings(earningCapital(c), c.base_yield, sector, sentiment, driverFactor(sector, state.markets, m) * sectorFactor(state, sector.id, data), growthFactor(c, state.world.turn, sector), spread(rng));
    c.earnings = [...c.earnings, e].slice(-4);

    const failure = sector.failure * (trailingEarnings(c) < 0 ? 1 : m.prices.sound_failure) * data.tuning.sentiment_multiplier[sentiment];
    if (rng.next() < Math.min(1, failure)) {
      const lost = holdingValue(state, c.id);
      c.status = "failed";
      c.price = 0;
      if (lost > 0) addEntry(state, "shares", "company_failure", -lost, `${c.name} has failed; its shares are worthless`);
      delete state.markets.shares[c.id];
      news(state, `${c.name} has failed${trailingEarnings(c) < 0 ? " after a year of losses" : ""}.${lost > 0 ? ` The house's shares, worth ${fl(lost)}, are worthless.` : ""}`, "A company fails");
      continue;
    }

    if (state.world.quarter === 4) {
      c.last_dividend = Math.round(dividendPerShare(c) * 100) / 100;
      const paid = Math.round(sharesHeld(state, c.id) * c.last_dividend);
      if (paid > 0) {
        state.house.cash += paid;
        addEntry(state, "cash", "dividend", paid, `${c.name}: dividend of ${fl(c.last_dividend)} a share on ${sharesHeld(state, c.id)} shares`);
      }
    }
  }
  chargeStorage(state, data);
}

/**
 * Marks the markets for next quarter, after its mood is rolled and its events have fired (as bonds
 * are marked): at the end of Q3 the year's harvest is rolled; shocks fade, then events that just
 * fired and the markets' own news for next quarter add theirs; companies due next quarter list;
 * every commodity and listed company gets its next price (one draw each, commodities first); and
 * holdings are revalued in the ledger. Mutates `state`.
 */
export function markMarkets(state: GameState, data: GameData): void {
  withMarketsRng(state, (rng) => stepMark(state, rng, data));
}

export function stepMark(state: GameState, rng: Rng, data: GameData): void {
  const m = data.markets;
  const mk = state.markets;
  const { world } = state;
  const coming = nextQuarter(world.year, world.quarter);

  if (world.quarter === 3) {
    mk.harvest = rollHarvest(m, world.year, rng);
    const parts = m.regions.map((r) => `${outcome(m, mk.harvest[r.id]!).name} in ${r.name}`);
    news(state, `The harvest is in: ${parts.join(", ")}.`, "The harvest");
  }

  fadeShocks(mk, m.shock_decay);
  for (const f of state.fired_events) {
    if (f.turn === world.turn && m.event_shocks[f.id]) applyShock(mk, m.event_shocks[f.id]!);
  }
  for (const n of m.news) {
    if (n.year !== coming.year || n.quarter !== coming.quarter) continue;
    applyShock(mk, n.shock);
    news(state, n.text, n.title);
  }

  for (const c of mk.companies) {
    if (c.status !== "upcoming") continue;
    const t = m.companies.find((x) => x.id === c.id);
    if (!t || t.list_year !== coming.year || t.list_quarter !== coming.quarter) continue;
    c.status = "listed";
    c.listed_turn = world.turn + 1;
    c.price = Math.round(Math.max(m.prices.min_price, fairValue(c, world.sentiment, m)) * 100) / 100;
    news(state, `${c.name} lists on the Frankfurt bourse, ${c.shares} shares opening at about ${fl(c.price)} each. ${t.description}`, "New on the bourse");
  }

  const books = {
    shares: Object.fromEntries(Object.keys(mk.shares).map((id) => [id, holdingValue(state, id)])),
    goods: Object.fromEntries(Object.keys(mk.goods).map((id) => [id, goodsValue(state, id)])),
  };
  for (const type of m.commodities) {
    const c = mk.commodities[type.id]!;
    c.price = nextCommodityPrice(c.price, commodityTarget(type, mk, coming.year, coming.quarter, m), spread(rng), type, c.level);
  }
  for (const c of mk.companies) {
    if (c.status !== "listed" || c.listed_turn === world.turn + 1) continue;
    c.price = nextSharePrice(c.price, fairValue(c, world.sentiment, m), c.shock, spread(rng), sectorOf(m, c.sector), m);
  }
  for (const [id, was] of Object.entries(books.shares)) {
    const diff = holdingValue(state, id) - was;
    if (diff) addEntry(state, "shares", "market_revaluation", diff, `${company(state, id)?.name ?? id}: marked to ${fl(company(state, id)?.price ?? 0)} a share`);
  }
  for (const [id, was] of Object.entries(books.goods)) {
    const diff = goodsValue(state, id) - was;
    const type = m.commodities.find((x) => x.id === id);
    if (diff) addEntry(state, "commodities", "market_revaluation", diff, `${type?.name ?? id}: marked to ${fl(mk.commodities[id]!.price)} per ${type?.unit ?? "unit"}`);
  }
}

/** What the house's shares and goods are worth at their last prices, for net worth. */
export function marketsBook(state: GameState): number {
  return sharesBook(state) + commoditiesBook(state);
}

export const isMarketsDecision = (d: Decision): d is MarketsDecision => (MARKETS_KINDS as readonly string[]).includes(d.kind);

export function applyMarketsDecision(state: GameState, d: MarketsDecision, data: GameData): DecisionResult {
  switch (d.kind) {
    case "buy_shares":
      return buyShares(state, d, data);
    case "sell_shares":
      return sellShares(state, d, data);
    case "buy_commodity":
      return buyCommodity(state, d, data);
    case "sell_commodity":
      return sellCommodity(state, d, data);
    case "company_report":
      return buyCompanyReport(state, d, data);
    case "sell_venture":
      return sellVenture(state, d, data);
  }
}

export function describeMarketsDecision(d: MarketsDecision, state: GameState, data: GameData): string {
  const cname = (id: string) => company(state, id)?.name ?? id;
  const good = (id: string) => data.markets.commodities.find((c) => c.id === id);
  switch (d.kind) {
    case "buy_shares":
      return `Buy ${d.shares} shares of ${cname(d.company)}`;
    case "sell_shares":
      return `Sell ${d.shares} shares of ${cname(d.company)}`;
    case "buy_commodity":
      return `Buy ${d.units} ${good(d.commodity)?.unit ?? "units"} of ${(good(d.commodity)?.name ?? d.commodity).toLowerCase()}`;
    case "sell_commodity":
      return `Sell ${d.units} ${good(d.commodity)?.unit ?? "units"} of ${(good(d.commodity)?.name ?? d.commodity).toLowerCase()}`;
    case "company_report":
      return `Buy ${data.markets.reports[d.tier]?.name ?? "a report"} on ${cname(d.company)}`;
    case "sell_venture":
      return `Sell the stake in venture #${d.venture} at a discount`;
  }
}
