// Bankruptcy auctions. When a house fails, its warehouse, ships, shares and broker's place go to
// auction; when a borrower defaults on a commercial loan or a mortgage, its collateral does. Lots
// are open for one quarter. The other houses bid less the worse the market, so bargains go to
// whoever kept cash. Warehouses, ships and broker's places earn each quarter and can be lost;
// shares join the house's market holdings.
import type { DecisionResult } from "../actions";
import { checkCapacity, useCapacity } from "../capacity";
import { fl } from "../format";
import { tradingHouses } from "../houses";
import { addEntry } from "../ledger";
import { holdingValue } from "../markets/holdings";
import { freeCash } from "../reserves";
import type { Rng } from "../rng";
import { cloneState } from "../state";
import type { GameData } from "../tuning";
import type { GameState, OtherHouse } from "../types";
import { changeReputation, financeNews, nextId, pct, roundTo } from "./common";
import type { Asset, AssetKind, BidLotDecision, Lot, SellAssetDecision } from "./types";

export function openLots(state: GameState): Lot[] {
  return state.finance.lots.filter((l) => l.open_turn === state.world.turn);
}

export function assetsBook(state: GameState): number {
  return state.finance.assets.reduce((s, a) => s + a.appraisal, 0);
}

export const bidPrice = (lot: Pick<Lot, "appraisal">, bid: number) => Math.round(lot.appraisal * bid);

/** Lots for a failed house, from data/finance.json, valued as shares of its wealth. A shares lot needs a listed company (one roll picks it). */
export function houseLots(state: GameState, h: OtherHouse, rng: Rng, data: GameData): void {
  const listed = state.markets.companies.filter((c) => c.status === "listed" && c.price > 0);
  for (const spec of data.finance.auctions.house_lots) {
    let appraisal = roundTo(h.wealth * spec.share, 100);
    let company: { id: string; name: string } | undefined;
    let shares: number | undefined;
    if (spec.kind === "shares") {
      if (!listed.length) continue;
      const c = listed[Math.floor(rng.next() * listed.length)]!;
      shares = Math.floor(appraisal / c.price);
      appraisal = Math.round(shares * c.price);
      company = c;
    }
    if (appraisal < data.finance.auctions.min_appraisal) continue;
    const name = spec.name.replace("{house}", h.name).replace("{company}", company?.name ?? "");
    state.finance.lots.push({
      id: nextId(state), kind: spec.kind, name, appraisal, source: h.name, open_turn: state.world.turn + 1, player_bid: null,
      ...(company ? { company: company.id, shares } : {}),
    });
  }
  financeNews(state, `The receivers of ${h.name} will auction its warehouse, ships and holdings next quarter.`, "An auction of a failed house");
}

/**
 * Collateral of borrowers who defaulted on the house's commercial loans and mortgages since the
 * last look goes to auction next quarter: a ship for river freight and shipping trades, a
 * warehouse for the rest, valued at a share of the collateral. Draws nothing. Mutates `state`.
 */
export function collateralLots(state: GameState, data: GameData): void {
  const t = data.finance.auctions;
  const seen = new Set(state.finance.seen_defaults);
  for (const loan of state.loans) {
    if (loan.status !== "defaulted" || seen.has(loan.id)) continue;
    state.finance.seen_defaults.push(loan.id);
    if (loan.kind === "bill") continue;
    const b = state.borrowers.find((x) => x.id === loan.borrower_id);
    if (!b) continue;
    const appraisal = roundTo(b.books.collateral * t.collateral_share, 100);
    if (appraisal < t.min_appraisal) continue;
    const ship = t.ship_trades.includes(b.trade);
    state.finance.lots.push({
      id: nextId(state), kind: ship ? "ship" : "warehouse", name: `${b.name}'s ${ship ? "barges" : "warehouse"}`, appraisal,
      source: b.name, open_turn: state.world.turn + 1, player_bid: null,
    });
    financeNews(state, `${b.name}'s ${ship ? "barges go" : "warehouse goes"} to auction next quarter, valued at ${fl(appraisal)}`);
  }
}

export function checkBidLot(state: GameState, d: BidLotDecision, data: GameData): string | null {
  const lot = openLots(state).find((l) => l.id === d.lot);
  if (!lot) return `No lot ${d.lot} is up for auction this quarter`;
  const noAction = checkCapacity(state, "bid_lot", data.tuning);
  if (noAction) return noAction;
  if (lot.player_bid !== null) return `The house has already bid for ${lot.name}`;
  if (!data.finance.auctions.bids.includes(d.bid)) return `A bid must be one of ${data.finance.auctions.bids.map(pct).join(", ")} of the appraisal`;
  if (lot.kind === "broker_place" && state.finance.assets.some((a) => a.kind === "broker_place")) return "The house already has a broker's place on the bourse";
  const price = bidPrice(lot, d.bid);
  if (price > freeCash(state)) return `Not enough cash above the reserve (bid ${fl(price)}, free ${fl(freeCash(state))})`;
  return null;
}

/** Bids for a lot. Nothing is paid unless the bid wins at End Turn. Returns a new state. */
export function bidLot(state: GameState, d: BidLotDecision, data: GameData): DecisionResult {
  const reason = checkBidLot(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  next.finance.lots.find((l) => l.id === d.lot)!.player_bid = d.bid;
  useCapacity(next, "bid_lot", data.tuning);
  return { ok: true, state: next };
}

/**
 * Settles this quarter's lots. Each house still trading with wealth of at least `rival_wealth_cover`
 * x the appraisal may bid (one roll), at the mood's share of the appraisal with noise (another).
 * The highest bid wins; a tie goes to the player. With no bids the lot is sold for scrap. A
 * winning player pays from cash; a bid the till can no longer cover lapses. Mutates `state`.
 */
export function settleAuctions(state: GameState, rng: Rng, data: GameData): void {
  const t = data.finance.auctions;
  const lots = openLots(state);
  state.finance.lots = state.finance.lots.filter((l) => l.open_turn > state.world.turn);
  for (const lot of lots) {
    let best: { who: string; price: number } | null = null;
    if (lot.player_bid !== null) {
      const price = bidPrice(lot, lot.player_bid);
      if (state.house.cash >= price && state.house.status !== "bankrupt") best = { who: "player", price };
      else financeNews(state, `${state.house.name}'s bid for ${lot.name} lapsed: the cash was not in the till.`);
    }
    for (const h of tradingHouses(state)) {
      if (h.wealth < lot.appraisal * t.rival_wealth_cover) continue;
      if (rng.next() >= t.rival_bid_chance) continue;
      const price = Math.round(lot.appraisal * t.rival_bid[state.world.sentiment] * (1 + t.rival_noise * (2 * rng.next() - 1)));
      if (!best || price > best.price) best = { who: h.id, price };
    }
    if (!best) {
      financeNews(state, `No one bid for ${lot.name}; the receivers sold it for scrap.`);
      continue;
    }
    if (best.who === "player") buyLot(state, lot, best.price, data);
    else {
      const h = state.houses.find((x) => x.id === best.who)!;
      h.wealth += lot.appraisal - best.price;
      const ours = lot.player_bid !== null ? " Your bid was not enough." : "";
      financeNews(state, `${h.name} bought ${lot.name} for ${fl(best.price)} (valued at ${fl(lot.appraisal)}).${ours}`);
    }
  }
}

/** The player takes a lot it won. The bargain (appraisal less price) shows at once in the books. */
function buyLot(state: GameState, lot: Lot, price: number, data: GameData): void {
  state.house.cash -= price;
  const note = `Bought ${lot.name} at auction for ${fl(price)}`;
  addEntry(state, "cash", "auction_purchase", -price, note);
  if (lot.kind === "shares") {
    const before = holdingValue(state, lot.company!);
    state.markets.shares[lot.company!] = (state.markets.shares[lot.company!] ?? 0) + lot.shares!;
    const gained = holdingValue(state, lot.company!) - before;
    addEntry(state, "shares", "auction_purchase", price, note);
    if (gained - price !== 0) addEntry(state, "shares", "asset_revaluation", gained - price, `${lot.name} at the bourse's price`);
  } else {
    const asset: Asset = { id: nextId(state), kind: lot.kind, name: lot.name, appraisal: lot.appraisal, paid: price, bought_turn: state.world.turn };
    state.finance.assets.push(asset);
    addEntry(state, "assets", "auction_purchase", price, note);
    if (lot.appraisal !== price) addEntry(state, "assets", "asset_revaluation", lot.appraisal - price, `${lot.name} at its appraisal`);
    if (lot.kind === "broker_place") changeReputation(state, data.finance.auctions.broker_place_reputation);
  }
  financeNews(state, `${state.house.name} bought ${lot.name} for ${fl(price)}, valued at ${fl(lot.appraisal)}`, "A bargain at auction");
}

/** Loss chance a quarter for an asset or a policy of this kind, this quarter. */
export function seasonFactor(state: GameState, data: GameData): number {
  return data.finance.auctions.winter_quarters.includes(state.world.quarter) ? data.finance.auctions.winter_factor : 1;
}

/**
 * Each owned asset may be lost (fire for a warehouse, the sea for a ship, more in winter and in a
 * storm; one roll each), else earns its yield (a ship's with the market's mood). Mutates `state`.
 */
export function runAssets(state: GameState, rng: Rng, data: GameData, stormFactor: number): void {
  const t = data.finance.auctions;
  for (const a of [...state.finance.assets]) {
    const spec = t.assets[a.kind];
    const chance = spec.loss_chance * (a.kind === "ship" ? seasonFactor(state, data) * stormFactor : 1);
    if (chance > 0 && rng.next() < chance) {
      state.finance.assets = state.finance.assets.filter((x) => x.id !== a.id);
      addEntry(state, "assets", "asset_lost", -a.appraisal, `${a.name} ${a.kind === "ship" ? "lost at sea" : "burned"}`);
      financeNews(state, `${a.name} ${a.kind === "ship" ? "has been lost on the river" : "has burned to the ground"}. It was not insured.`, a.kind === "ship" ? "Lost" : "Fire");
      continue;
    }
    const income = Math.round(((a.appraisal * spec.yield) / 4) * (spec.mood_income ? t.mood_income[state.world.sentiment] : 1));
    if (income <= 0) continue;
    state.house.cash += income;
    addEntry(state, "cash", "asset_income", income, `${a.kind === "warehouse" ? "Rent" : a.kind === "ship" ? "Freight" : "Brokerage"} from ${a.name}`);
  }
}

export function checkSellAsset(state: GameState, d: SellAssetDecision, data: GameData): string | null {
  if (!state.finance.assets.some((a) => a.id === d.asset)) return `The house owns no asset ${d.asset}`;
  return checkCapacity(state, "sell_asset", data.tuning);
}

export const assetSalePrice = (a: Pick<Asset, "appraisal">, discount: number) => Math.round(a.appraisal * (1 - discount));

/** Sells an asset at its appraisal less the sale discount. Returns a new state. */
export function sellAsset(state: GameState, d: SellAssetDecision, data: GameData): DecisionResult {
  const reason = checkSellAsset(state, d, data);
  if (reason) return { ok: false, reason };
  const next = cloneState(state);
  sellAssetAt(next, next.finance.assets.find((a) => a.id === d.asset)!, data.finance.auctions.sale_discount, "asset_sale", "sold");
  useCapacity(next, "sell_asset", data.tuning);
  return { ok: true, state: next };
}

/** Sells an asset at `discount` off its appraisal. Returns the cash raised. Mutates `state`. */
export function sellAssetAt(state: GameState, a: Asset, discount: number, category: "asset_sale" | "forced_sale", why: string): number {
  const price = assetSalePrice(a, discount);
  state.finance.assets = state.finance.assets.filter((x) => x.id !== a.id);
  state.house.cash += price;
  const note = `${a.name} ${why} for ${fl(price)}`;
  addEntry(state, "cash", category, price, note);
  addEntry(state, "assets", category, -a.appraisal, note);
  return price;
}

export const ASSET_WORDS: Record<AssetKind, string> = { warehouse: "warehouse", ship: "ships", broker_place: "broker's place" };
